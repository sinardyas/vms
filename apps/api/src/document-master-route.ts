/**
 * Document Master + category-requirements matrix (M2.3, #34, ADR-0013) — the master list of compliance
 * document types plus the category→document requirements the M5 activation gate evaluates.
 *
 * The document list is a thin **instantiation** of the M2.1 master framework (`masterListRoutes` +
 * `drizzleMasterStore`, #32), exactly like the M2.2 registration lists (#33): its RBAC module
 * (`document_master`), bilingual `name_id`/`name_en` (via `@vms/domain`'s `bilingualLabelFields`), a
 * unique **create-only** `no` (`DOC-001`) that drives the 409, and the origin `applies_to` +
 * `mandatory` fields the gate reads. The one twist vs. the five registration lists: `document_master`
 * names its soft-enable flag **`enabled`**, not `active`, so the store is pointed at it via
 * `activeColumn` + `activeField` — the DTO still exposes a uniform `active` so the generic route + UI
 * work unchanged. Soft-delete keeps the deactivate-hides-from-new-captures rule (a disabled doc is no
 * longer requested from vendors) while existing references keep resolving.
 *
 * The **requirements matrix** (`category_document_requirements`) is *not* a labelled master row — it's
 * an M:N join `(category × document, mandatory)` — so it gets a small bespoke sub-router over its own
 * injectable {@link RequirementStore} seam (still transactional + atomically audited like the store
 * framework). A cell is set (create-or-reactivate, with its `mandatory` flag) or removed (soft-delete),
 * which is exactly the input M5.2's gate reads: `required(origin,category) = origin docs ∪ category docs`.
 */

import { categoryDocumentRequirements, db as defaultDb, documentMaster } from "@vms/db";
import {
  type DocAppliesTo,
  type RequestContext,
  bilingualLabelFields,
  bilingualLabelPatchFields,
  docAppliesToSchema,
  notFoundError,
  parseWith,
  validationError,
} from "@vms/domain";
import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { writeAudit } from "./audit";
import type { AppEnv } from "./context";
import { sendError } from "./http-error";
import { type MasterDTO, masterListRoutes } from "./master-list";
import { drizzleMasterStore } from "./master-store";
import { requirePermission } from "./rbac";

/** Document Master (list + matrix) gates on its own RBAC module (ADR-0012). */
const MODULE = "document_master" as const;

/** A required, trimmed, length-capped string (matches a `varchar(max)` column). */
const str = (max: number) => z.string().trim().min(1).max(max);

/* ── document_master — bilingual compliance-doc type (active flag = `enabled`) ── */

export type DocumentMasterDTO = MasterDTO & {
  readonly no: string;
  readonly nameId: string;
  readonly nameEn: string;
  readonly type: string;
  readonly appliesTo: DocAppliesTo;
  readonly validityDays: number;
  readonly mandatory: boolean;
  readonly reminder: string;
};

export const documentMasterCreate = z.object({
  no: str(16),
  ...bilingualLabelFields(200),
  type: str(40),
  appliesTo: docAppliesToSchema,
  validityDays: z.number().int().min(0).optional(),
  mandatory: z.boolean().optional(),
  reminder: str(20).optional(),
});
export const documentMasterUpdate = z.object({
  ...bilingualLabelPatchFields(200),
  type: str(40).optional(),
  appliesTo: docAppliesToSchema.optional(),
  validityDays: z.number().int().min(0).optional(),
  mandatory: z.boolean().optional(),
  reminder: str(20).optional(),
});
type DocumentMasterCreate = z.infer<typeof documentMasterCreate>;
type DocumentMasterUpdate = z.infer<typeof documentMasterUpdate>;

const documentMasterStore = drizzleMasterStore({
  table: documentMaster,
  idColumn: documentMaster.id,
  activeColumn: documentMaster.enabled, // document_master's soft-enable flag is `enabled`, not `active`
  activeField: "enabled",
  orderBy: documentMaster.no,
  module: MODULE,
  subjectType: "document_master",
  unique: { column: documentMaster.no, valueOf: (i: DocumentMasterCreate) => i.no },
  insertValues: (i: DocumentMasterCreate) => ({
    no: i.no,
    nameId: i.nameId,
    nameEn: i.nameEn,
    type: i.type,
    appliesTo: i.appliesTo,
    ...(i.validityDays !== undefined ? { validityDays: i.validityDays } : {}),
    ...(i.mandatory !== undefined ? { mandatory: i.mandatory } : {}),
    ...(i.reminder !== undefined ? { reminder: i.reminder } : {}),
  }),
  updateValues: (p: DocumentMasterUpdate) => ({
    ...(p.nameId !== undefined ? { nameId: p.nameId } : {}),
    ...(p.nameEn !== undefined ? { nameEn: p.nameEn } : {}),
    ...(p.type !== undefined ? { type: p.type } : {}),
    ...(p.appliesTo !== undefined ? { appliesTo: p.appliesTo } : {}),
    ...(p.validityDays !== undefined ? { validityDays: p.validityDays } : {}),
    ...(p.mandatory !== undefined ? { mandatory: p.mandatory } : {}),
    ...(p.reminder !== undefined ? { reminder: p.reminder } : {}),
  }),
  toDTO: (r): DocumentMasterDTO => ({
    id: r.id,
    active: r.enabled, // uniform `active` for the generic route/UI, sourced from the `enabled` column
    no: r.no,
    nameId: r.nameId,
    nameEn: r.nameEn,
    type: r.type,
    appliesTo: r.appliesTo,
    validityDays: r.validityDays,
    mandatory: r.mandatory,
    reminder: r.reminder,
  }),
});

/* ── category_document_requirements — the M:N matrix (bespoke, not a labelled master) ── */

/** One requirement cell: a (category, document) pair the gate reads, with its `mandatory` flag. */
export type RequirementDTO = {
  readonly id: string;
  readonly categoryId: string;
  readonly documentMasterId: string;
  readonly mandatory: boolean;
};

/** Body of a matrix set: which category requires which doc, and whether it's gate-mandatory. */
export const requirementSet = z.object({
  categoryId: z.string().uuid(),
  documentMasterId: z.string().uuid(),
  mandatory: z.boolean().optional(),
});
type RequirementSet = z.infer<typeof requirementSet>;

/**
 * The data-access seam for the matrix — every DB touch, so the router is testable with a fake. `set`
 * upserts a requirement (create or reactivate + refresh `mandatory`); `remove` soft-deletes it (a null
 * return means the pair was never a requirement → 404). `list` returns the **active** requirements only
 * (the gate input); deactivated pairs are history, not current requirements.
 */
export type RequirementStore = {
  readonly list: () => Promise<RequirementDTO[]>;
  readonly set: (ctx: RequestContext, input: RequirementSet) => Promise<RequirementDTO>;
  readonly remove: (
    ctx: RequestContext,
    categoryId: string,
    documentMasterId: string,
  ) => Promise<RequirementDTO | null>;
};

const reqDTO = (r: typeof categoryDocumentRequirements.$inferSelect): RequirementDTO => ({
  id: r.id,
  categoryId: r.categoryId,
  documentMasterId: r.documentMasterId,
  mandatory: r.mandatory,
});

/**
 * The real {@link RequirementStore} over `category_document_requirements`. Each mutation runs in a
 * transaction that also writes its audit row on the same handle (atomic, mirroring the master store).
 * The upsert leans on the `(category_id, document_master_id)` unique index; removal is a soft-delete
 * (`active=false`), never a `DELETE`, so the requirement history is retained (ADR-0011 spirit).
 */
export const drizzleRequirementStore = (dbHandle = defaultDb): RequirementStore => ({
  list: async () => {
    const rows = await dbHandle
      .select()
      .from(categoryDocumentRequirements)
      .where(eq(categoryDocumentRequirements.active, true));
    return rows.map(reqDTO);
  },

  set: async (ctx, input) =>
    dbHandle.transaction(async (tx) => {
      const [row] = await tx
        .insert(categoryDocumentRequirements)
        .values({
          categoryId: input.categoryId,
          documentMasterId: input.documentMasterId,
          mandatory: input.mandatory ?? true,
        })
        .onConflictDoUpdate({
          target: [
            categoryDocumentRequirements.categoryId,
            categoryDocumentRequirements.documentMasterId,
          ],
          set: { mandatory: input.mandatory ?? true, active: true, updatedAt: new Date() },
        })
        .returning();
      if (!row) throw new Error("category_document_requirement upsert returned no row");
      await writeAudit(tx, ctx, {
        action: "category_document_requirement.set",
        module: MODULE,
        subjectType: "category_document_requirement",
        subjectId: row.id,
      });
      return reqDTO(row);
    }),

  remove: async (ctx, categoryId, documentMasterId) => {
    // Only an *active* requirement can be removed — re-deleting an already-cleared cell is a 404
    // (nothing to do), never a second soft-delete + audit row.
    const [exists] = await dbHandle
      .select({ id: categoryDocumentRequirements.id })
      .from(categoryDocumentRequirements)
      .where(
        and(
          eq(categoryDocumentRequirements.categoryId, categoryId),
          eq(categoryDocumentRequirements.documentMasterId, documentMasterId),
          eq(categoryDocumentRequirements.active, true),
        ),
      )
      .limit(1);
    if (!exists) return null;
    return dbHandle.transaction(async (tx) => {
      const [row] = await tx
        .update(categoryDocumentRequirements)
        .set({ active: false, updatedAt: new Date() })
        .where(eq(categoryDocumentRequirements.id, exists.id))
        .returning();
      await writeAudit(tx, ctx, {
        action: "category_document_requirement.removed",
        module: MODULE,
        subjectType: "category_document_requirement",
        subjectId: exists.id,
      });
      return reqDTO(row);
    });
  },
});

/**
 * The matrix sub-router. `GET /` lists the current requirements; `PUT /` sets a cell (upsert with its
 * `mandatory` flag); `DELETE /:categoryId/:documentMasterId` clears it. Each mutation is guarded on the
 * `document_master` module and audited atomically. Mount under a parent running the request-context
 * middleware (so `c.var.ctx` + the guards work).
 */
export const requirementRoutes = (
  store: RequirementStore = drizzleRequirementStore(),
): Hono<AppEnv> => {
  const app = new Hono<AppEnv>();

  app.get("/", requirePermission(MODULE, "view"), async (c) => {
    return c.json({ items: await store.list() });
  });

  app.put("/", requirePermission(MODULE, "edit"), async (c) => {
    let raw: unknown;
    try {
      raw = await c.req.json();
    } catch {
      return sendError(c, validationError());
    }
    const parsed = parseWith(requirementSet, raw);
    if (!parsed.ok) return sendError(c, parsed.error);
    return c.json({ item: await store.set(c.var.ctx, parsed.value) });
  });

  app.delete("/:categoryId/:documentMasterId", requirePermission(MODULE, "delete"), async (c) => {
    const item = await store.remove(
      c.var.ctx,
      c.req.param("categoryId"),
      c.req.param("documentMasterId"),
    );
    return item === null ? sendError(c, notFoundError()) : c.json({ item });
  });

  return app;
};

/**
 * Build the `/console/document-master` router: the document-type list (the M2.1 master CRUD surface)
 * plus the category-requirements matrix nested at `/requirements`. Mount under a parent running the
 * request-context middleware, as in `apps/api/index`.
 */
export const documentMasterRoutes = (): Hono<AppEnv> => {
  const app = new Hono<AppEnv>();

  // Requirements first so its nested paths aren't shadowed by the list's `/:id` routes.
  app.route("/requirements", requirementRoutes());
  app.route(
    "/",
    masterListRoutes({
      module: MODULE,
      createSchema: documentMasterCreate,
      updateSchema: documentMasterUpdate,
      store: documentMasterStore,
    }),
  );

  return app;
};
