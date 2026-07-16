/**
 * Approval workflow engine — the acting surface (M4.2, #57, ADR-0005/0012).
 *
 * The half of the engine that runs *after* a request is open (opened at submit by `approval-engine.ts`):
 * the queue + detail reads the console shows, and the decisions that walk a request through its route —
 * **approve** (advance to the next step, or on the final step resolve `approved` and activate the
 * subject), **reject** (resolve `rejected` and return the subject to Draft with reasons), and
 * **reassign/delegate** an open step's assignee. The route→steps sequencing is config-driven (ADR-0005):
 * the pure `applyDecision` ({@link @vms/domain}) decides *what* each decision does; this store persists
 * it — the step decision, the request's advance/resolve, the subject effect, and the audit — in one
 * transaction.
 *
 * **Scope boundary (M4.2):** deciding is gated only by RBAC (`approvals:approve`) here. Separation of
 * duties (no self-approval, verifier ≠ approver) and the zero-eligible → admin-override escalation are
 * **M4.3** — the eligibility primitive ({@link approverIneligibility}, M1.6) plugs in at the decide
 * handler. Final approval activates the vendor **unconditionally**; **M5.2** inserts the
 * all-mandatory-docs-Verified activation gate at the `activate` effect below. Post-activation edit
 * triggers (bank/non-bank change) are **M4.5**; this ticket wires the registration triggers.
 *
 * Stores are injectable so the whole surface is testable without Postgres; the router is mounted at
 * `/console/approvals` (internal console), RBAC-gated on the `approvals` module, every mutation audited.
 */

import {
  type DB,
  approvalRequestSteps,
  approvalRequests,
  db as defaultDb,
  roles,
  vendors,
} from "@vms/db";
import {
  type ApprovalDecision,
  type RequestContext,
  type StepDecision,
  applyDecision,
  conflictError,
  notFoundError,
  parseWith,
  validationError,
} from "@vms/domain";
import { and, asc, eq } from "drizzle-orm";
import { type Context, Hono } from "hono";
import { z } from "zod";
import { writeAudit } from "./audit";
import type { AppEnv } from "./context";
import { sendError } from "./http-error";
import { requirePermission } from "./rbac";

/** The approval engine gates on its own RBAC module (ADR-0012). */
const MODULE = "approvals" as const;

/* ── DTOs (the JSON the console reads) ─────────────────────────────────────────────────────────── */

/** One step of a request as the detail view renders it — its role, assignee, and recorded decision. */
export type ApprovalStepDTO = {
  readonly stepNo: number;
  readonly roleId: string;
  readonly roleCode: string;
  readonly roleNameId: string;
  readonly roleNameEn: string;
  readonly assigneeUserId: string | null;
  readonly decision: StepDecision;
  readonly decidedBy: string | null;
  readonly reason: string | null;
  readonly decidedAt: string | null;
  readonly isOverride: boolean;
};

/** A request as the queue lists it — enough to badge it and see whose step it's on. */
export type ApprovalRequestSummaryDTO = {
  readonly id: string;
  readonly subjectVendorId: string;
  readonly vendorName: string;
  readonly trigger: string;
  readonly status: string;
  readonly currentStepNo: number;
  readonly currentStepRoleId: string | null;
  readonly currentStepRoleCode: string | null;
  readonly currentAssigneeUserId: string | null;
  readonly submittedBy: string | null;
  readonly createdAt: string;
};

/** A request opened in detail — the summary plus its full ordered step history. */
export type ApprovalRequestDetailDTO = ApprovalRequestSummaryDTO & {
  readonly routeId: string;
  readonly resolvedAt: string | null;
  readonly steps: ApprovalStepDTO[];
};

/* ── Store seam ────────────────────────────────────────────────────────────────────────────────── */

/** Which requests to list: open ones, optionally scoped to a vendor or to the caller's own queue. */
export type QueueFilter = {
  readonly vendorId?: string;
  /** Restrict to requests whose current open step is assigned to this user ("my queue"). */
  readonly assigneeUserId?: string;
};

/** A decision on a request's current step. `reason` is required for reject (ADR-0005: reject w/ reasons). */
export type DecideInput = {
  readonly requestId: string;
  readonly deciderUserId: string | null;
  readonly decision: ApprovalDecision;
  readonly reason: string | null;
};

/** Decide outcome: applied (fresh detail), or why it couldn't be — unknown / already resolved. */
export type DecideOutcome =
  | { readonly ok: true; readonly detail: ApprovalRequestDetailDTO }
  | { readonly ok: false; readonly reason: "not_found" | "not_pending" };

/** Reassign/delegate an open step's assignee. */
export type ReassignInput = {
  readonly requestId: string;
  readonly stepNo: number;
  readonly assigneeUserId: string;
};

/** Reassign outcome: applied, or why not — unknown request / the step isn't the current open one. */
export type ReassignOutcome =
  | { readonly ok: true; readonly detail: ApprovalRequestDetailDTO }
  | { readonly ok: false; readonly reason: "not_found" | "not_actionable" };

/**
 * The data-access seam behind the router — every DB touch, so the surface is testable without Postgres.
 * `decide` and `reassign` are transactional + atomically audited; the reads feed the queue/detail views.
 */
export type ApprovalStore = {
  readonly listOpen: (filter: QueueFilter) => Promise<ApprovalRequestSummaryDTO[]>;
  readonly getDetail: (requestId: string) => Promise<ApprovalRequestDetailDTO | null>;
  readonly decide: (ctx: RequestContext, input: DecideInput) => Promise<DecideOutcome>;
  readonly reassign: (ctx: RequestContext, input: ReassignInput) => Promise<ReassignOutcome>;
};

/* ── The real Drizzle store ────────────────────────────────────────────────────────────────────── */

/** Anything that can run a Drizzle `select` — the ambient `db` or an open transaction (for post-write reads). */
type ReadHandle = Pick<DB, "select">;

const iso = (d: Date | null): string | null => (d ? d.toISOString() : null);

export const drizzleApprovalStore = (dbHandle: DB = defaultDb): ApprovalStore => {
  /** Load a request joined to its subject vendor's name; `null` if the request is unknown. */
  const loadRequest = async (handle: ReadHandle, requestId: string) => {
    const [row] = await handle
      .select({
        id: approvalRequests.id,
        subjectVendorId: approvalRequests.subjectVendorId,
        vendorName: vendors.name,
        trigger: approvalRequests.trigger,
        status: approvalRequests.status,
        currentStepNo: approvalRequests.currentStepNo,
        routeId: approvalRequests.routeId,
        submittedBy: approvalRequests.submittedBy,
        resolvedAt: approvalRequests.resolvedAt,
        createdAt: approvalRequests.createdAt,
      })
      .from(approvalRequests)
      .innerJoin(vendors, eq(vendors.id, approvalRequests.subjectVendorId))
      .where(eq(approvalRequests.id, requestId))
      .limit(1);
    return row ?? null;
  };

  /** Load a request's steps in order, joined to their roles (with each role's lead for auto-dispatch). */
  const loadSteps = (handle: ReadHandle, requestId: string) =>
    handle
      .select({
        stepNo: approvalRequestSteps.stepNo,
        roleId: approvalRequestSteps.roleId,
        roleCode: roles.code,
        roleNameId: roles.nameId,
        roleNameEn: roles.nameEn,
        leadUserId: roles.leadUserId,
        assigneeUserId: approvalRequestSteps.assigneeUserId,
        decision: approvalRequestSteps.decision,
        decidedBy: approvalRequestSteps.decidedBy,
        reason: approvalRequestSteps.reason,
        decidedAt: approvalRequestSteps.decidedAt,
        isOverride: approvalRequestSteps.isOverride,
      })
      .from(approvalRequestSteps)
      .innerJoin(roles, eq(roles.id, approvalRequestSteps.roleId))
      .where(eq(approvalRequestSteps.requestId, requestId))
      .orderBy(asc(approvalRequestSteps.stepNo));

  /** Assemble the detail DTO (request row + ordered steps). `null` if the request is gone. */
  const buildDetail = async (
    handle: ReadHandle,
    requestId: string,
  ): Promise<ApprovalRequestDetailDTO | null> => {
    const row = await loadRequest(handle, requestId);
    if (!row) return null;
    const steps = await loadSteps(handle, requestId);
    const current = steps.find((s) => s.stepNo === row.currentStepNo);
    return {
      id: row.id,
      subjectVendorId: row.subjectVendorId,
      vendorName: row.vendorName,
      trigger: row.trigger,
      status: row.status,
      currentStepNo: row.currentStepNo,
      currentStepRoleId: current?.roleId ?? null,
      currentStepRoleCode: current?.roleCode ?? null,
      currentAssigneeUserId: current?.assigneeUserId ?? null,
      submittedBy: row.submittedBy,
      createdAt: row.createdAt.toISOString(),
      routeId: row.routeId,
      resolvedAt: iso(row.resolvedAt),
      steps: steps.map((s) => ({
        stepNo: s.stepNo,
        roleId: s.roleId,
        roleCode: s.roleCode,
        roleNameId: s.roleNameId,
        roleNameEn: s.roleNameEn,
        assigneeUserId: s.assigneeUserId,
        decision: s.decision,
        decidedBy: s.decidedBy,
        reason: s.reason,
        decidedAt: iso(s.decidedAt),
        isOverride: s.isOverride,
      })),
    };
  };

  return {
    listOpen: async (filter) => {
      const conds = [eq(approvalRequests.status, "pending")];
      if (filter.vendorId) conds.push(eq(approvalRequests.subjectVendorId, filter.vendorId));
      if (filter.assigneeUserId) {
        conds.push(eq(approvalRequestSteps.assigneeUserId, filter.assigneeUserId));
      }
      const rows = await dbHandle
        .select({
          id: approvalRequests.id,
          subjectVendorId: approvalRequests.subjectVendorId,
          vendorName: vendors.name,
          trigger: approvalRequests.trigger,
          status: approvalRequests.status,
          currentStepNo: approvalRequests.currentStepNo,
          submittedBy: approvalRequests.submittedBy,
          createdAt: approvalRequests.createdAt,
          currentStepRoleId: approvalRequestSteps.roleId,
          currentStepRoleCode: roles.code,
          currentAssigneeUserId: approvalRequestSteps.assigneeUserId,
        })
        .from(approvalRequests)
        .innerJoin(vendors, eq(vendors.id, approvalRequests.subjectVendorId))
        // The request's *current* step (stepNo = currentStepNo) — the one awaiting a decision.
        .leftJoin(
          approvalRequestSteps,
          and(
            eq(approvalRequestSteps.requestId, approvalRequests.id),
            eq(approvalRequestSteps.stepNo, approvalRequests.currentStepNo),
          ),
        )
        .leftJoin(roles, eq(roles.id, approvalRequestSteps.roleId))
        .where(and(...conds))
        .orderBy(asc(approvalRequests.createdAt));
      return rows.map((r) => ({
        id: r.id,
        subjectVendorId: r.subjectVendorId,
        vendorName: r.vendorName,
        trigger: r.trigger,
        status: r.status,
        currentStepNo: r.currentStepNo,
        currentStepRoleId: r.currentStepRoleId,
        currentStepRoleCode: r.currentStepRoleCode,
        currentAssigneeUserId: r.currentAssigneeUserId,
        submittedBy: r.submittedBy,
        createdAt: r.createdAt.toISOString(),
      }));
    },

    getDetail: (requestId) => buildDetail(dbHandle, requestId),

    decide: (ctx, input) =>
      dbHandle.transaction(async (tx): Promise<DecideOutcome> => {
        const row = await loadRequest(tx, input.requestId);
        if (!row) return { ok: false, reason: "not_found" };
        if (row.status !== "pending") return { ok: false, reason: "not_pending" };

        const steps = await loadSteps(tx, input.requestId);
        const current = steps.find((s) => s.stepNo === row.currentStepNo);
        if (!current) throw new Error("pending approval request has no current step row");

        const outcome = applyDecision(row.currentStepNo, steps.length, input.decision);
        const now = new Date();

        // 1. Record the decision on the current step.
        await tx
          .update(approvalRequestSteps)
          .set({
            decision: input.decision === "approve" ? "approved" : "rejected",
            decidedBy: input.deciderUserId,
            reason: input.reason,
            decidedAt: now,
            updatedAt: now,
          })
          .where(
            and(
              eq(approvalRequestSteps.requestId, input.requestId),
              eq(approvalRequestSteps.stepNo, row.currentStepNo),
            ),
          );

        // 2. Advance to the next step (auto-assign its role's lead, ADR-0012) or resolve the request.
        if (outcome.advanceToStepNo !== null) {
          const next = steps.find((s) => s.stepNo === outcome.advanceToStepNo);
          await tx
            .update(approvalRequests)
            .set({ currentStepNo: outcome.advanceToStepNo, updatedAt: now })
            .where(eq(approvalRequests.id, input.requestId));
          await tx
            .update(approvalRequestSteps)
            .set({ assigneeUserId: next?.leadUserId ?? null, updatedAt: now })
            .where(
              and(
                eq(approvalRequestSteps.requestId, input.requestId),
                eq(approvalRequestSteps.stepNo, outcome.advanceToStepNo),
              ),
            );
        } else {
          await tx
            .update(approvalRequests)
            .set({ status: outcome.requestStatus, resolvedAt: now, updatedAt: now })
            .where(eq(approvalRequests.id, input.requestId));
        }

        // 3. Apply the subject effect. Registration: final approve → vendor Active; reject → Draft.
        if (outcome.subjectEffect === "activate") {
          // M5.2 inserts the activation gate here (block until all mandatory docs are Verified).
          await tx
            .update(vendors)
            .set({ status: "active", updatedAt: now })
            .where(eq(vendors.id, row.subjectVendorId));
        } else if (outcome.subjectEffect === "return_to_draft") {
          await tx
            .update(vendors)
            .set({ status: "draft", updatedAt: now })
            .where(eq(vendors.id, row.subjectVendorId));
        }

        // 4. Audit — the request decision, plus the vendor state change it caused.
        const requestAction =
          outcome.requestStatus === "approved"
            ? "approval_request.approved"
            : outcome.requestStatus === "rejected"
              ? "approval_request.rejected"
              : "approval_request.advanced";
        await writeAudit(tx, ctx, {
          action: requestAction,
          module: MODULE,
          subjectType: "approval_request",
          subjectId: input.requestId,
        });
        if (outcome.subjectEffect === "activate") {
          await writeAudit(tx, ctx, {
            action: "vendor.activated",
            module: "vendors",
            subjectType: "vendor",
            subjectId: row.subjectVendorId,
          });
        } else if (outcome.subjectEffect === "return_to_draft") {
          await writeAudit(tx, ctx, {
            action: "vendor.returned_to_draft",
            module: "vendors",
            subjectType: "vendor",
            subjectId: row.subjectVendorId,
          });
        }

        const detail = await buildDetail(tx, input.requestId);
        if (!detail) throw new Error("approval request vanished mid-decision");
        return { ok: true, detail };
      }),

    reassign: (ctx, input) =>
      dbHandle.transaction(async (tx): Promise<ReassignOutcome> => {
        const row = await loadRequest(tx, input.requestId);
        if (!row) return { ok: false, reason: "not_found" };
        // Only the current open step of a pending request can be reassigned.
        if (row.status !== "pending" || row.currentStepNo !== input.stepNo) {
          return { ok: false, reason: "not_actionable" };
        }
        const [step] = await tx
          .select({ assigneeUserId: approvalRequestSteps.assigneeUserId })
          .from(approvalRequestSteps)
          .where(
            and(
              eq(approvalRequestSteps.requestId, input.requestId),
              eq(approvalRequestSteps.stepNo, input.stepNo),
            ),
          )
          .limit(1);
        if (!step) return { ok: false, reason: "not_actionable" };
        const now = new Date();
        await tx
          .update(approvalRequestSteps)
          .set({
            assigneeUserId: input.assigneeUserId,
            reassignedFrom: step.assigneeUserId,
            updatedAt: now,
          })
          .where(
            and(
              eq(approvalRequestSteps.requestId, input.requestId),
              eq(approvalRequestSteps.stepNo, input.stepNo),
            ),
          );
        await writeAudit(tx, ctx, {
          action: "approval_request.reassigned",
          module: MODULE,
          subjectType: "approval_request",
          subjectId: input.requestId,
        });
        const detail = await buildDetail(tx, input.requestId);
        if (!detail) throw new Error("approval request vanished mid-reassign");
        return { ok: true, detail };
      }),
  };
};

/* ── Router ────────────────────────────────────────────────────────────────────────────────────── */

/** Approve carries an optional note; reject requires a reason (ADR-0005: reject returns Draft w/ reasons). */
const decideBodySchema = z.object({ reason: z.string().trim().max(1000).optional() });
const reassignBodySchema = z.object({ assigneeUserId: z.string().uuid() });

/** Read + parse a JSON body against `schema`; malformed JSON → a localized 400. */
const parseBody = async <T>(c: Context<AppEnv>, schema: z.ZodType<T>) => {
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    return { ok: false as const, error: validationError() };
  }
  return parseWith(schema, raw);
};

/**
 * Build the `/console/approvals` engine router. `GET /` is the queue (open requests; `?mine=1` scopes to
 * the caller's assigned steps, `?vendorId=` to one vendor); `GET /:id` the detail; `POST /:id/approve`
 * and `/:id/reject` decide; `POST /:id/steps/:stepNo/reassign` delegates a step. Gated on `approvals`,
 * every mutation audited. Mount under the authenticated `/console` prefix (request-context middleware).
 */
export const approvalRoutes = (store: ApprovalStore = drizzleApprovalStore()): Hono<AppEnv> => {
  const app = new Hono<AppEnv>();

  app.get("/", requirePermission(MODULE, "view"), async (c) => {
    const actor = c.var.ctx.actor;
    const filter: QueueFilter = {
      vendorId: c.req.query("vendorId") || undefined,
      assigneeUserId: c.req.query("mine") ? (actor?.userId ?? undefined) : undefined,
    };
    return c.json({ items: await store.listOpen(filter) });
  });

  app.get("/:id", requirePermission(MODULE, "view"), async (c) => {
    const item = await store.getDetail(c.req.param("id"));
    return item ? c.json({ item }) : sendError(c, notFoundError());
  });

  // approve / reject share the decide store; the verb differs and reject requires a reason. `requestId`
  // is read at each inline registration (so Hono infers the `:id` param as a string) and passed in.
  const runDecide = async (c: Context<AppEnv>, requestId: string, decision: ApprovalDecision) => {
    const parsed = await parseBody(c, decideBodySchema);
    if (!parsed.ok) return sendError(c, parsed.error);
    const reason = parsed.value.reason ?? null;
    if (decision === "reject" && !reason) {
      return sendError(c, validationError({ messageKey: "error.approval.reasonRequired" }));
    }
    const outcome = await store.decide(c.var.ctx, {
      requestId,
      deciderUserId: c.var.ctx.actor?.userId ?? null,
      decision,
      reason,
    });
    if (!outcome.ok) {
      return outcome.reason === "not_found"
        ? sendError(c, notFoundError())
        : sendError(c, conflictError({ messageKey: "error.approval.notPending" }));
    }
    return c.json({ item: outcome.detail });
  };

  app.post("/:id/approve", requirePermission(MODULE, "approve"), (c) =>
    runDecide(c, c.req.param("id"), "approve"),
  );
  app.post("/:id/reject", requirePermission(MODULE, "approve"), (c) =>
    runDecide(c, c.req.param("id"), "reject"),
  );

  app.post("/:id/steps/:stepNo/reassign", requirePermission(MODULE, "approve"), async (c) => {
    const stepNo = Number.parseInt(c.req.param("stepNo"), 10);
    if (!Number.isInteger(stepNo) || stepNo < 1) return sendError(c, validationError());
    const parsed = await parseBody(c, reassignBodySchema);
    if (!parsed.ok) return sendError(c, parsed.error);
    const outcome = await store.reassign(c.var.ctx, {
      requestId: c.req.param("id"),
      stepNo,
      assigneeUserId: parsed.value.assigneeUserId,
    });
    if (!outcome.ok) {
      return outcome.reason === "not_found"
        ? sendError(c, notFoundError())
        : sendError(c, conflictError({ messageKey: "error.approval.stepNotActionable" }));
    }
    return c.json({ item: outcome.detail });
  });

  return app;
};
