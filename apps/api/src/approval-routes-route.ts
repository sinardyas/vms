/**
 * Approval Routes (M2.4, #35, ADR-0009/0011) — the trigger→ordered-steps routing table the M4 workflow
 * engine resolves, delivered as CRUD + console + seeds on the M2.1 master framework.
 *
 * The **route header** (`approval_routes`) is a thin instantiation of the framework (`masterListRoutes`
 * + `drizzleMasterStore`, #32), exactly like the M2.2/M2.3 lists: its RBAC module (`approval_routes`),
 * bilingual `name_id`/`name_en`, a unique **create-only** `trigger` (one route per `approval_trigger`)
 * that drives the 409, and soft-delete (a deactivated route stops routing new requests while existing
 * `approval_requests` that reference it keep resolving — the framework's referential rule).
 *
 * The **ordered steps** (`approval_route_steps`) are *not* a labelled master row — they're an ordered
 * child collection `(route, stepNo → role)` — so they get a small bespoke sub-router over an injectable
 * {@link StepStore} (transactional + atomically audited, like M2.3's requirements matrix). The editor
 * always replaces the whole step-list, so `PUT /:routeId/steps` sets it in one shot, and that's where
 * the **deadlock guard** lives: reusing the M1.5 eligibility count (#24) + M1.6's SoD primitive (#25)
 * projected to config time (`strandedStepRoles`), a save that leaves a step whose role has no eligible
 * approver is a re-confirmable **422** (ADR-0011b) — the same shape the Access admin uses. A `/roles`
 * helper feeds the editor its approver-role dropdown, gated on `approval_routes` (not `access`).
 */

import {
  type DB,
  approvalRouteSteps,
  approvalRoutes,
  db as defaultDb,
  rolePermissions,
  roles,
  userRoles,
  users,
} from "@vms/db";
import {
  type RequestContext,
  type Result,
  err,
  invariantError,
  isErr,
  notFoundError,
  parseWith,
  validationError,
} from "@vms/domain";
import { and, eq, exists, inArray } from "drizzle-orm";
import { type Context, Hono } from "hono";
import type { ZodType } from "zod";
import {
  type ApprovalRouteDTO,
  type ReplaceStepsInput,
  type RolePickDTO,
  type RouteStepDTO,
  createRouteSchema,
  formatStrandedRoles,
  replaceStepsSchema,
  strandedStepRoles,
  updateRouteSchema,
} from "./approval-routes-service";
import { type AuditEntry, writeAudit } from "./audit";
import type { AppEnv } from "./context";
import { sendError } from "./http-error";
import { type MasterDTO, masterListRoutes } from "./master-list";
import { drizzleMasterStore } from "./master-store";
import { requirePermission } from "./rbac";

/** Approval Routes gate on their own RBAC module (ADR-0012) — routes *and* their steps + role picker. */
const MODULE = "approval_routes" as const;

/* ── Route header — the M2.1 master CRUD surface over `approval_routes` ── */

const approvalRouteStore = drizzleMasterStore({
  table: approvalRoutes,
  idColumn: approvalRoutes.id,
  activeColumn: approvalRoutes.active,
  orderBy: approvalRoutes.trigger,
  module: MODULE,
  subjectType: "approval_route",
  // One route per trigger (the routing key) — create-only, so an edit can never collide (409 on create).
  unique: { column: approvalRoutes.trigger, valueOf: (i: { trigger: string }) => i.trigger },
  insertValues: (i: { trigger: string; nameId: string; nameEn: string }) => ({
    trigger: i.trigger,
    nameId: i.nameId,
    nameEn: i.nameEn,
  }),
  updateValues: (p: { nameId?: string; nameEn?: string }) => ({
    ...(p.nameId !== undefined ? { nameId: p.nameId } : {}),
    ...(p.nameEn !== undefined ? { nameEn: p.nameEn } : {}),
  }),
  toDTO: (r): ApprovalRouteDTO & MasterDTO => ({
    id: r.id,
    active: r.active,
    trigger: r.trigger,
    nameId: r.nameId,
    nameEn: r.nameEn,
  }),
});

/* ── Ordered steps — the bespoke sub-router with the deadlock guard ── */

/** The outcome of a steps replace: applied, stranded (deadlock 422), or referencing an unusable role. */
export type ReplaceStepsResult =
  | { readonly ok: true; readonly steps: RouteStepDTO[] }
  | { readonly ok: false; readonly deadlock: RolePickDTO[] }
  | { readonly ok: false; readonly unknownRole: true };

/**
 * The data-access seam for a route's steps — every DB touch, so the sub-router is testable with a fake.
 * `replaceSteps` is transactional + atomically audited and runs the deadlock guard; `listRoles`
 * feeds the editor's approver-role dropdown.
 */
export type StepStore = {
  readonly listByRoute: (routeId: string) => Promise<RouteStepDTO[] | null>;
  readonly replaceSteps: (
    ctx: RequestContext,
    routeId: string,
    input: ReplaceStepsInput,
  ) => Promise<ReplaceStepsResult | null>;
  readonly listRoles: () => Promise<RolePickDTO[]>;
};

const stepDTO = (row: {
  id: string;
  routeId: string;
  stepNo: number;
  roleId: string;
  roleCode: string;
  roleNameId: string;
  roleNameEn: string;
}): RouteStepDTO => row;

/** The real {@link StepStore} over `approval_route_steps` joined to `roles`. */
export const drizzleStepStore = (db: DB = defaultDb): StepStore => {
  /** Read one route's steps in order, joined to their roles. `null` if the route itself is gone. */
  const listByRoute = async (routeId: string): Promise<RouteStepDTO[] | null> => {
    const [route] = await db
      .select({ id: approvalRoutes.id })
      .from(approvalRoutes)
      .where(eq(approvalRoutes.id, routeId))
      .limit(1);
    if (!route) return null;
    const rows = await db
      .select({
        id: approvalRouteSteps.id,
        routeId: approvalRouteSteps.routeId,
        stepNo: approvalRouteSteps.stepNo,
        roleId: approvalRouteSteps.roleId,
        roleCode: roles.code,
        roleNameId: roles.nameId,
        roleNameEn: roles.nameEn,
      })
      .from(approvalRouteSteps)
      .innerJoin(roles, eq(roles.id, approvalRouteSteps.roleId))
      .where(eq(approvalRouteSteps.routeId, routeId))
      .orderBy(approvalRouteSteps.stepNo);
    return rows.map(stepDTO);
  };

  /** The distinct step roles (from `candidates`) that are *staffable*: some active user carrying that
   * role also holds `approvals:approve` through an active role (M1.6's permission half at config time). */
  const eligibleStepRoles = async (candidates: string[]): Promise<Set<string>> => {
    if (candidates.length === 0) return new Set();
    const holdsApprove = exists(
      db
        .select({ one: userRoles.userId })
        .from(userRoles)
        .innerJoin(roles, and(eq(roles.id, userRoles.roleId), eq(roles.active, true)))
        .innerJoin(
          rolePermissions,
          and(
            eq(rolePermissions.roleId, roles.id),
            eq(rolePermissions.module, "approvals"),
            eq(rolePermissions.canApprove, true),
          ),
        )
        .where(eq(userRoles.userId, users.id)),
    );
    const rows = await db
      .selectDistinct({ roleId: userRoles.roleId })
      .from(userRoles)
      .innerJoin(users, and(eq(users.id, userRoles.userId), eq(users.active, true)))
      .where(and(inArray(userRoles.roleId, candidates), holdsApprove));
    return new Set(rows.map((r) => r.roleId));
  };

  /** Resolve the given ids to *active* roles — used to reject unknown/inactive step roles + label deadlocks. */
  const activeRolesByIds = async (ids: string[]): Promise<RolePickDTO[]> => {
    if (ids.length === 0) return [];
    return db
      .select({ id: roles.id, code: roles.code, nameId: roles.nameId, nameEn: roles.nameEn })
      .from(roles)
      .where(and(inArray(roles.id, ids), eq(roles.active, true)));
  };

  return {
    listByRoute,

    listRoles: async () =>
      db
        .select({ id: roles.id, code: roles.code, nameId: roles.nameId, nameEn: roles.nameEn })
        .from(roles)
        .where(eq(roles.active, true))
        .orderBy(roles.code),

    replaceSteps: async (ctx, routeId, input) => {
      const [route] = await db
        .select({ id: approvalRoutes.id })
        .from(approvalRoutes)
        .where(eq(approvalRoutes.id, routeId))
        .limit(1);
      if (!route) return null;

      const afterRoleIds = input.steps.map((s) => s.roleId);

      // Every step must name an existing, active role — otherwise the insert would FK-fail (or worse,
      // wire a step to a deactivated role the engine can never assign). Reject before touching the DB.
      const distinctAfter = [...new Set(afterRoleIds)];
      const known = new Set((await activeRolesByIds(distinctAfter)).map((r) => r.id));
      if (distinctAfter.some((id) => !known.has(id))) return { ok: false, unknownRole: true };

      const beforeSteps = (await listByRoute(routeId)) ?? [];
      const beforeRoleIds = beforeSteps.map((s) => s.roleId);

      // Deadlock guard (ADR-0011b): reusing the eligibility count (#24) + SoD primitive projection
      // (#25), warn only when the save takes a *working* route to one with an un-staffable step.
      const candidates = [...new Set([...beforeRoleIds, ...afterRoleIds])];
      const eligible = await eligibleStepRoles(candidates);
      const stranded = strandedStepRoles(beforeRoleIds, afterRoleIds, eligible);
      if (stranded.length > 0 && !(input.confirm ?? false)) {
        return { ok: false, deadlock: await activeRolesByIds(stranded) };
      }

      const steps = await db.transaction(async (tx) => {
        await tx.delete(approvalRouteSteps).where(eq(approvalRouteSteps.routeId, routeId));
        await tx
          .insert(approvalRouteSteps)
          .values(afterRoleIds.map((roleId, i) => ({ routeId, stepNo: i + 1, roleId })));
        const audit: AuditEntry = {
          action: "approval_route.steps_updated",
          module: MODULE,
          subjectType: "approval_route",
          subjectId: routeId,
        };
        await writeAudit(tx, ctx, audit);
        return (await listByRoute(routeId)) ?? [];
      });
      return { ok: true, steps };
    },
  };
};

/** Read + validate a JSON body against `schema`, as a domain `Result` (malformed JSON → validation). */
const readBody = async <T>(c: Context<AppEnv>, schema: ZodType<T>): Promise<Result<T>> => {
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    return err(validationError());
  }
  return parseWith(schema, raw);
};

/** Map a stranded step-role set to the localized, re-confirmable deadlock warning (422). */
const deadlock = (c: Context<AppEnv>, stranded: readonly RolePickDTO[]) =>
  sendError(
    c,
    invariantError({
      messageKey: "approvalRoutes.deadlock.warning",
      params: { roles: formatStrandedRoles(stranded) },
    }),
  );

/**
 * The steps sub-router: `GET /:routeId/steps` lists a route's ordered steps; `PUT /:routeId/steps`
 * replaces them (deadlock-guarded, 422 re-confirmable); `GET /roles` feeds the approver-role picker.
 * Mount under a parent running the request-context middleware (so `c.var.ctx` + the guards work).
 */
export const stepRoutes = (store: StepStore = drizzleStepStore()): Hono<AppEnv> => {
  const app = new Hono<AppEnv>();

  app.get("/roles", requirePermission(MODULE, "view"), async (c) =>
    c.json({ roles: await store.listRoles() }),
  );

  app.get("/:routeId/steps", requirePermission(MODULE, "view"), async (c) => {
    const steps = await store.listByRoute(c.req.param("routeId"));
    return steps === null ? sendError(c, notFoundError()) : c.json({ items: steps });
  });

  app.put("/:routeId/steps", requirePermission(MODULE, "edit"), async (c) => {
    const body = await readBody(c, replaceStepsSchema);
    if (isErr(body)) return sendError(c, body.error);
    const result = await store.replaceSteps(c.var.ctx, c.req.param("routeId"), body.value);
    if (result === null) return sendError(c, notFoundError());
    if (!result.ok) {
      return "unknownRole" in result
        ? sendError(c, validationError())
        : deadlock(c, result.deadlock);
    }
    return c.json({ items: result.steps });
  });

  return app;
};

/**
 * Build the `/console/approval-routes` router: the route-header master CRUD plus the ordered-steps
 * sub-router (and its role picker). Mount under a parent running the request-context middleware, as in
 * `apps/api/index`. The steps + roles routes are registered before the header's `/:id` routes so their
 * paths aren't shadowed.
 */
export const approvalRouteRoutes = (stepStore: StepStore = drizzleStepStore()): Hono<AppEnv> => {
  const app = new Hono<AppEnv>();

  app.route("/", stepRoutes(stepStore));
  app.route(
    "/",
    masterListRoutes({
      module: MODULE,
      createSchema: createRouteSchema,
      updateSchema: updateRouteSchema,
      store: approvalRouteStore,
    }),
  );

  return app;
};
