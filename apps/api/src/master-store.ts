/**
 * Master-list CRUD framework — the Drizzle store (M2.1, #32, ADR-0011).
 *
 * The real {@link MasterStore} behind the generic router (`master-list.ts`): one implementation that
 * serves **any** master table carrying the shared `activeFlag` + `timestamps` columns (`@vms/db`
 * `_shared.ts`). A concrete list (M2.2+) calls {@link drizzleMasterStore} with its table, the columns
 * to filter/join on, and small mappers (input → insert values, patch → update values, row → DTO) — and
 * inherits soft delete, capturable filtering, unique-clash detection, and **atomic audit** for free.
 *
 * Every mutation runs inside a transaction that ends with {@link writeAudit} on the *same* handle, so
 * the change and its audit row commit together (M1.4 DoD) — the exact pattern the M1.5 Access store
 * uses. Deactivation is an `UPDATE … SET active=false`, never a `DELETE`: rows are retained forever so
 * existing vendor references keep resolving (ADR-0011 referential invariant). `document_master` names
 * its flag `enabled`; pass `activeColumn` + `activeField` to point the framework at whatever it's called.
 */

import { type DB, db as defaultDb } from "@vms/db";
import type { RbacModule, RequestContext } from "@vms/domain";
import { type SQL, eq } from "drizzle-orm";
import type { PgColumn, PgTable } from "drizzle-orm/pg-core";
import { type AuditEntry, writeAudit } from "./audit";
import type { Created, MasterDTO, MasterStore } from "./master-list";

/** A Drizzle table paired with its `$inferSelect` / `$inferInsert` row shapes. */
type Table = PgTable & {
  $inferSelect: Record<string, unknown>;
  $inferInsert: Record<string, unknown>;
};

/**
 * How a concrete master table is wired to the generic store. The mappers keep this fully type-safe at
 * each call site (the table is concrete there), while the store body stays table-agnostic.
 */
export type DrizzleMasterSpec<TTable extends Table, TCreate, TUpdate, TDTO extends MasterDTO> = {
  /** The Drizzle table this list reads and writes. */
  readonly table: TTable;
  /** The table's primary-key column — used for `WHERE id = …` and result attribution. */
  readonly idColumn: PgColumn;
  /** The soft-enable column, for the capturable filter (`WHERE active = true`). Default: `table.active`. */
  readonly activeColumn: PgColumn;
  /** The soft-enable **property key** (for the update `SET`). Default: `"active"`; `document_master` → `"enabled"`. */
  readonly activeField?: string;
  /** The RBAC module this list belongs to — stamped on every audit row. */
  readonly module: RbacModule;
  /** The audit `subjectType` + action prefix, e.g. `"business_entity"` → `business_entity.created`. */
  readonly subjectType: string;
  /** Stable list order — a column to `ORDER BY`. Defaults to the primary key. */
  readonly orderBy?: PgColumn;
  /** A uniqueness rule: the column to check + the value to look for in the create input (for the 409). */
  readonly unique?: { readonly column: PgColumn; readonly valueOf: (input: TCreate) => string };
  /** Project a create input to the table's insert values. */
  readonly insertValues: (input: TCreate) => TTable["$inferInsert"];
  /** Project an update patch to the columns to set (only the provided ones; `updatedAt` is added here). */
  readonly updateValues: (patch: TUpdate) => Partial<TTable["$inferInsert"]>;
  /** Shape a selected row into the DTO the API returns. */
  readonly toDTO: (row: TTable["$inferSelect"]) => TDTO;
  /** Override the ambient client (a test/tx handle). */
  readonly db?: DB;
};

/** A permissive view of the Drizzle client — the generic-table builders are typed loosely by design. */
type LooseDB = {
  select: (fields?: Record<string, PgColumn>) => {
    from: (t: PgTable) => {
      where: (w: SQL) => { limit: (n: number) => Promise<Record<string, unknown>[]> };
      orderBy: (c: PgColumn) => Promise<Record<string, unknown>[]>;
    };
  };
  insert: (t: PgTable) => {
    values: (v: Record<string, unknown>) => { returning: () => Promise<Record<string, unknown>[]> };
  };
  update: (t: PgTable) => {
    set: (v: Record<string, unknown>) => {
      where: (w: SQL) => { returning: () => Promise<Record<string, unknown>[]> };
    };
  };
  transaction: <T>(fn: (tx: LooseDB) => Promise<T>) => Promise<T>;
};

/**
 * Build the real {@link MasterStore} for one master table. Type-safe at the call site (the table and
 * its mappers are concrete); the body treats the table generically over the shared column contract.
 */
export const drizzleMasterStore = <TTable extends Table, TCreate, TUpdate, TDTO extends MasterDTO>(
  spec: DrizzleMasterSpec<TTable, TCreate, TUpdate, TDTO>,
): MasterStore<TCreate, TUpdate, TDTO> => {
  const db = (spec.db ?? defaultDb) as unknown as LooseDB;
  const {
    table,
    idColumn,
    activeColumn,
    module,
    subjectType,
    unique,
    insertValues,
    updateValues,
    toDTO,
  } = spec;
  const activeField = spec.activeField ?? "active";
  const orderBy = spec.orderBy ?? idColumn;

  const dto = (row: Record<string, unknown>): TDTO => toDTO(row as TTable["$inferSelect"]);
  const idOf = (row: Record<string, unknown>): string => String(row.id);

  /**
   * Run `apply` and its audit row in one transaction, so the change and the log commit together. The
   * callback returns the mapped value plus the row's id, so a *create* can audit the id it just minted.
   */
  const audited = async <T>(
    ctx: RequestContext,
    action: string,
    apply: (tx: LooseDB) => Promise<{ value: T; subjectId: string }>,
  ): Promise<T> =>
    db.transaction(async (tx) => {
      const { value, subjectId } = await apply(tx);
      const entry: AuditEntry = { action, module, subjectType, subjectId };
      // `tx` is the same handle the mutation used — the audit insert commits atomically with it.
      await writeAudit(tx as unknown as Parameters<typeof writeAudit>[0], ctx, entry);
      return value;
    });

  return {
    list: async ({ capturableOnly }) => {
      const rows = capturableOnly
        ? await db.select().from(table).where(eq(activeColumn, true)).limit(Number.MAX_SAFE_INTEGER)
        : await db.select().from(table).orderBy(orderBy);
      return rows.map(dto);
    },

    create: async (ctx, input): Promise<Created<TDTO>> => {
      if (unique) {
        const [clash] = await db
          .select({ id: idColumn })
          .from(table)
          .where(eq(unique.column, unique.valueOf(input)))
          .limit(1);
        if (clash) return { ok: false, conflict: true };
      }
      const value = await audited(ctx, `${subjectType}.created`, async (tx) => {
        const [row] = await tx.insert(table).values(insertValues(input)).returning();
        if (!row) throw new Error(`${subjectType} insert returned no row`);
        return { value: dto(row), subjectId: idOf(row) };
      });
      return { ok: true, value };
    },

    update: async (ctx, id, patch) => {
      const [exists] = await db
        .select({ id: idColumn })
        .from(table)
        .where(eq(idColumn, id))
        .limit(1);
      if (!exists) return null;
      return audited(ctx, `${subjectType}.updated`, async (tx) => {
        const [row] = await tx
          .update(table)
          .set({ ...updateValues(patch), updatedAt: new Date() })
          .where(eq(idColumn, id))
          .returning();
        return { value: dto(row as Record<string, unknown>), subjectId: id };
      });
    },

    setActive: async (ctx, id, active) => {
      const [exists] = await db
        .select({ id: idColumn })
        .from(table)
        .where(eq(idColumn, id))
        .limit(1);
      if (!exists) return null;
      const action = `${subjectType}.${active ? "reactivated" : "deactivated"}`;
      return audited(ctx, action, async (tx) => {
        const [row] = await tx
          .update(table)
          .set({ [activeField]: active, updatedAt: new Date() })
          .where(eq(idColumn, id))
          .returning();
        return { value: dto(row as Record<string, unknown>), subjectId: id };
      });
    },
  };
};
