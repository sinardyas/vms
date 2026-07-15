/**
 * Master-list CRUD framework — the generic route (M2.1, #32, ADR-0006/0011).
 *
 * The reusable seam every M2 master-data list is built on, so **active/deactivate (no hard delete)**,
 * **bilingual labels**, **referential integrity**, RBAC gating, and **atomic audit** are inherited by
 * construction rather than re-implemented per list. A concrete list (M2.2+) supplies its RBAC module,
 * its Zod create/update schemas (composed from `@vms/domain`'s `bilingualLabelFields`), and a
 * {@link MasterStore} — and gets the whole CRUD surface:
 *
 *   GET    /               list — every row for the console; `?active=true` filters to **capturable**
 *                          rows only (the capture path, ADR-0011 referential rule)
 *   POST   /               create — 201, or 409 on a unique-key clash
 *   PATCH  /:id            update — 404 if the row is gone
 *   DELETE /:id            **soft delete** — sets `active=false`; the row is retained so existing
 *                          references keep resolving (never a hard delete)
 *   POST   /:id/reactivate un-deactivate — sets `active=true`
 *
 * Every mutation is guarded (`requirePermission(module, verb)`) and audited atomically inside the
 * store's transaction; validation flows through the domain's Zod→`Result` bridge. Data access is
 * behind the injectable {@link MasterStore} so the orchestration here is unit-testable with a fake —
 * no Postgres — exactly like the M1.5 Access admin it mirrors. The real store is `drizzleMasterStore`
 * (`master-store.ts`), which implements this seam over any master table with the shared `activeFlag`.
 */

import {
  type MessageKey,
  type RbacModule,
  type RequestContext,
  type Result,
  conflictError,
  err,
  isErr,
  notFoundError,
  parseWith,
  validationError,
} from "@vms/domain";
import { type Context, Hono } from "hono";
import type { ZodType } from "zod";
import type { AppEnv } from "./context";
import { sendError } from "./http-error";
import { requirePermission } from "./rbac";

/** The minimum every master DTO exposes — an id and its soft-enable flag; a list adds its own fields. */
export interface MasterDTO {
  readonly id: string;
  readonly active: boolean;
}

/** A create outcome: the new row, or a unique-key clash the route turns into a localized 409. */
export type Created<TDTO> =
  | { readonly ok: true; readonly value: TDTO }
  | { readonly ok: false; readonly conflict: true };

/**
 * The data-access seam a concrete master list plugs into — every DB touch, so the router is testable
 * with a fake. `list({ capturableOnly })` encodes the referential read split (capture vs resolution);
 * `setActive` is the soft delete / reactivate; a mutation returning `null` means the row vanished (404).
 */
export type MasterStore<TCreate, TUpdate, TDTO extends MasterDTO> = {
  readonly list: (opts: { readonly capturableOnly: boolean }) => Promise<TDTO[]>;
  readonly create: (ctx: RequestContext, input: TCreate) => Promise<Created<TDTO>>;
  readonly update: (ctx: RequestContext, id: string, patch: TUpdate) => Promise<TDTO | null>;
  readonly setActive: (ctx: RequestContext, id: string, active: boolean) => Promise<TDTO | null>;
};

/** How a concrete master list is wired to the generic router: its module, schemas, and store. */
export type MasterListConfig<TCreate, TUpdate, TDTO extends MasterDTO> = {
  /** The RBAC module the whole list gates on (e.g. `registration_lists`, `operational_lists`). */
  readonly module: RbacModule;
  readonly createSchema: ZodType<TCreate>;
  readonly updateSchema: ZodType<TUpdate>;
  readonly store: MasterStore<TCreate, TUpdate, TDTO>;
  /** Override the localized error keys; both default to the shared `master.error.*` catalogue keys. */
  readonly notFoundKey?: MessageKey;
  readonly conflictKey?: MessageKey;
};

/** Read + validate a JSON body against `schema` as a domain `Result` (malformed JSON → validation). */
const readBody = async <T>(c: Context<AppEnv>, schema: ZodType<T>): Promise<Result<T>> => {
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    return err(validationError());
  }
  return parseWith(schema, raw);
};

/**
 * Build a master-list CRUD router from a {@link MasterListConfig}. Mount it under a parent that runs
 * the request-context middleware (so `c.var.ctx` and the guards work), at the list's own path — e.g.
 * `app.route("/console/registration-lists/business-entities", masterListRoutes(config))`.
 */
export const masterListRoutes = <TCreate, TUpdate, TDTO extends MasterDTO>(
  config: MasterListConfig<TCreate, TUpdate, TDTO>,
): Hono<AppEnv> => {
  const app = new Hono<AppEnv>();
  const { module, store } = config;
  const notFoundKey = config.notFoundKey ?? "master.error.notFound";
  const conflictKey = config.conflictKey ?? "master.error.codeTaken";

  const gone = (c: Context<AppEnv>) => sendError(c, notFoundError({ messageKey: notFoundKey }));

  // List — the whole list for the console; `?active=true` narrows to capturable rows for the capture
  // path (registration dropdowns). Resolution reads fetch a single row by id and never filter active.
  app.get("/", requirePermission(module, "view"), async (c) => {
    const capturableOnly = c.req.query("active") === "true";
    return c.json({ items: await store.list({ capturableOnly }) });
  });

  app.post("/", requirePermission(module, "add"), async (c) => {
    const body = await readBody(c, config.createSchema);
    if (isErr(body)) return sendError(c, body.error);
    const result = await store.create(c.var.ctx, body.value);
    if (!result.ok) return sendError(c, conflictError({ messageKey: conflictKey }));
    return c.json({ item: result.value }, 201);
  });

  app.patch("/:id", requirePermission(module, "edit"), async (c) => {
    const body = await readBody(c, config.updateSchema);
    if (isErr(body)) return sendError(c, body.error);
    const item = await store.update(c.var.ctx, c.req.param("id"), body.value);
    return item === null ? gone(c) : c.json({ item });
  });

  // Soft delete: deactivate, never destroy. The row stays so existing vendor references still resolve.
  app.delete("/:id", requirePermission(module, "delete"), async (c) => {
    const item = await store.setActive(c.var.ctx, c.req.param("id"), false);
    return item === null ? gone(c) : c.json({ item });
  });

  app.post("/:id/reactivate", requirePermission(module, "edit"), async (c) => {
    const item = await store.setActive(c.var.ctx, c.req.param("id"), true);
    return item === null ? gone(c) : c.json({ item });
  });

  return app;
};
