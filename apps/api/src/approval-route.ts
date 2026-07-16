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
 * **Effects by trigger (ADR-0005):** the pure `applyDecision` reads the request's trigger to decide what
 * resolution *means*. A **registration** final-approve activates the vendor (reject → Draft); a
 * post-activation **edit** (M4.5 — bank/non-bank change) instead **applies its diff** to the still-Active
 * vendor (reject → **discards** it), then clears `change_pending` — the `apply_change`/`discard_change`
 * effects, landed by {@link applyVendorChange}/{@link discardVendorChange} in this same decide tx.
 *
 * **Separation of duties + escalation (M4.3, #58, ADR-0009/0014):** an **approve** is layered on top of
 * the RBAC `approvals:approve` gate with the M1.6 eligibility primitive ({@link approverIneligibility}) —
 * the submitter can't approve their own request (no self-approval, 403), nor can anyone who verified a
 * document on the subject vendor (verifier ≠ approver, 403). If SoD + permissions leave the current step
 * with **no eligible approver** ({@link hasEligibleApprover} = false), it must not silently stall: only a
 * holder of {@link OVERRIDE_PERMISSION} (`approvals:edit`, the admin) may approve it, and that decision is
 * flagged `is_override` + audited as a bypass. Reject stays RBAC-only (returning to Draft is not a
 * duty-concentration risk).
 *
 * **Activation gate (M5.2, ADR-0013):** eligibility answers *who may decide*, the gate answers *whether an
 * approval may take effect* — so SoD runs first, then a registration final-approve blocks (409, no write)
 * unless every mandatory doc is Verified ({@link computeActivationGate}); the same gate status rides on the
 * request detail so the console shows "N of M verified" before an approver decides.
 *
 * Stores are injectable so the whole surface is testable without Postgres; the router is mounted at
 * `/console/approvals` (internal console), RBAC-gated on the `approvals` module, every mutation audited.
 */

import {
  type DB,
  approvalRequestSteps,
  approvalRequests,
  db as defaultDb,
  documentSlots,
  documentVersions,
  rolePermissions,
  roles,
  userRoles,
  users,
  vendors,
} from "@vms/db";
import {
  APPROVE_PERMISSION,
  type ActivationGate,
  type ApprovalDecision,
  type ApproverCandidate,
  type PermissionSet,
  type RequestContext,
  type StepDecision,
  type VerifiableDocument,
  activationGate,
  activationGateError,
  applyDecision,
  approverIneligibility,
  conflictError,
  forbiddenError,
  hasEligibleApprover,
  hasOverrideAuthority,
  isEditTrigger,
  notFoundError,
  parseWith,
  toPermissionSet,
  validationError,
} from "@vms/domain";
import { and, asc, eq, inArray, isNotNull } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { type Context, Hono } from "hono";
import { z } from "zod";
import type { StepAssignment } from "./approval-engine";
import { writeAudit } from "./audit";
import { sendOfficeInvite } from "./auth";
import type { AppEnv } from "./context";
import { env } from "./env";
import { sendError } from "./http-error";
import { notificationReader, notifyDecision, notifyStepAssigned } from "./notification-events";
import { provisionOfficeOwner } from "./office-account";
import { expandGrants } from "./permissions";
import { requirePermission } from "./rbac";
import { requiredDocMasterIdsForVendor } from "./required-documents";
import { applyVendorChange, discardVendorChange } from "./vendor-change";

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
  readonly assigneeName: string | null;
  readonly decision: StepDecision;
  readonly decidedBy: string | null;
  readonly decidedByName: string | null;
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
  readonly currentStepRoleNameId: string | null;
  readonly currentStepRoleNameEn: string | null;
  readonly currentAssigneeUserId: string | null;
  readonly currentAssigneeName: string | null;
  readonly submittedBy: string | null;
  readonly createdAt: string;
};

/** A request opened in detail — the summary plus its full ordered step history. */
export type ApprovalRequestDetailDTO = ApprovalRequestSummaryDTO & {
  readonly routeId: string;
  readonly resolvedAt: string | null;
  /** The proposed diff for a post-activation edit (M4.5); `null` for a registration request. */
  readonly payload: unknown;
  readonly steps: ApprovalStepDTO[];
  /**
   * The M5.2 activation gate for a **registration** request — "N of M mandatory docs Verified" + the
   * blockers final-approve is waiting on (ADR-0013). `null` for an edit request (nothing activates), so
   * the console (M5.4) renders it only where it applies.
   */
  readonly activationGate: ActivationGate | null;
};

/** A user who could take a step — a candidate the delegate/reassign picker offers (holds the step's role). */
export type AssigneeCandidateDTO = {
  readonly userId: string;
  readonly name: string;
  readonly email: string;
};

/* ── Store seam ────────────────────────────────────────────────────────────────────────────────── */

/** Which requests to list: open ones, optionally scoped to a vendor, the caller's queue, or their roles. */
export type QueueFilter = {
  readonly vendorId?: string;
  /** Restrict to requests whose current open step is assigned to this user ("my queue"). */
  readonly assigneeUserId?: string;
  /**
   * Restrict to requests whose current open step's role is one of these ("role queue"). An **empty**
   * array is meaningful — a caller who holds no roles has an empty role queue — so it's distinct from
   * `undefined` (no role filter). The route passes the caller's own role ids for `?role=1`.
   */
  readonly roleIds?: readonly string[];
};

/** A decision on a request's current step. `reason` is required for reject (ADR-0005: reject w/ reasons). */
export type DecideInput = {
  readonly requestId: string;
  readonly deciderUserId: string | null;
  /**
   * The decider's resolved RBAC grants (from `ctx.actor`, M1.1) — the eligibility/override checks read
   * this rather than re-deriving from the DB, so they agree with the RBAC gate (and DEV_ACTOR) exactly.
   */
  readonly deciderPermissions: PermissionSet;
  readonly decision: ApprovalDecision;
  readonly reason: string | null;
};

/**
 * Decide outcome: applied (fresh detail), or why it couldn't be. Beyond unknown / already-resolved: the
 * SoD + escalation reasons (M4.3) — the decider is the submitter (`self_approval`) or verified a document
 * on the vendor (`verifier`), or the step is zero-eligible and the decider isn't an admin override
 * (`override_required`), all three 403 — and (M5.2) a registration final-approve blocked because not every
 * mandatory doc is Verified yet, a 409 whose `gate` rides along so the route can localize the "N of M
 * verified" message.
 */
/**
 * What a committed decision means for the outside world (M6.2, ADR-0012) — gathered inside the decide
 * transaction, delivered by the route once it has committed.
 *
 * The store can't send these itself: it *is* the transaction, and a notification sent from inside one
 * is a claim that might still be rolled back. But the route can't gather them either — the vendor's
 * source, the freshly-assigned next approver, and the invite address are all facts the tx read while
 * it held them. So the tx decides *what to say* and the route decides *when to say it*, which is the
 * only split that keeps both halves honest.
 */
export type DecideNotices = {
  /** Set when this decision resolved a **registration** — the vendor is told approved/rejected. */
  readonly decision: { readonly outcome: "approved" | "rejected" } | null;
  /** Set when the decision advanced the route — the next step's auto-assigned approver is told. */
  readonly nextAssignment: StepAssignment | null;
  /** Set when activation provisioned an office vendor's owner — their invite address (M6.2). */
  readonly officeInviteEmail: string | null;
};

export type DecideOutcome =
  | {
      readonly ok: true;
      readonly detail: ApprovalRequestDetailDTO;
      readonly notices: DecideNotices;
    }
  | {
      readonly ok: false;
      readonly reason:
        | "not_found"
        | "not_pending"
        | "self_approval"
        | "verifier"
        | "override_required";
    }
  | { readonly ok: false; readonly reason: "gate_blocked"; readonly gate: ActivationGate };

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
  /** The active role ids the given user holds — the "role queue" is the union of their steps. */
  readonly rolesForUser: (userId: string) => Promise<string[]>;
  /** Active users who hold a step's role — the pool the delegate/reassign picker offers. */
  readonly candidatesForStep: (
    requestId: string,
    stepNo: number,
  ) => Promise<AssigneeCandidateDTO[]>;
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
        // Whether the vendor registered itself or was registered on its behalf (M3.6) — an office
        // vendor's activation has to mint the owner account nobody created for it (M6.2).
        vendorSource: vendors.source,
        trigger: approvalRequests.trigger,
        status: approvalRequests.status,
        currentStepNo: approvalRequests.currentStepNo,
        routeId: approvalRequests.routeId,
        payload: approvalRequests.payload,
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

  // Aliased so one query can name both the step's assignee and its decider off the shared `users` table.
  const stepAssignee = alias(users, "step_assignee");
  const stepDecider = alias(users, "step_decider");

  /** Load a request's steps in order, joined to their roles + the assignee/decider display names. */
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
        assigneeName: stepAssignee.name,
        decision: approvalRequestSteps.decision,
        decidedBy: approvalRequestSteps.decidedBy,
        decidedByName: stepDecider.name,
        reason: approvalRequestSteps.reason,
        decidedAt: approvalRequestSteps.decidedAt,
        isOverride: approvalRequestSteps.isOverride,
      })
      .from(approvalRequestSteps)
      .innerJoin(roles, eq(roles.id, approvalRequestSteps.roleId))
      .leftJoin(stepAssignee, eq(stepAssignee.id, approvalRequestSteps.assigneeUserId))
      .leftJoin(stepDecider, eq(stepDecider.id, approvalRequestSteps.decidedBy))
      .where(eq(approvalRequestSteps.requestId, requestId))
      .orderBy(asc(approvalRequestSteps.stepNo));

  /**
   * The users who have verified any document on `vendorId` (M4.3 SoD: verifier ≠ approver, ADR-0009).
   * Reads `document_versions.verified_by` through the vendor's slots; empty until M5 populates it.
   */
  const loadVendorVerifiers = async (handle: ReadHandle, vendorId: string): Promise<string[]> => {
    const rows = await handle
      .select({ verifiedBy: documentVersions.verifiedBy })
      .from(documentVersions)
      .innerJoin(documentSlots, eq(documentSlots.id, documentVersions.slotId))
      .where(and(eq(documentSlots.vendorId, vendorId), isNotNull(documentVersions.verifiedBy)));
    return Array.from(new Set(rows.flatMap((r) => (r.verifiedBy ? [r.verifiedBy] : []))));
  };

  /**
   * The candidate approvers for a step: every active user holding its `roleId`, each with their **full**
   * resolved permission set (union across all their active roles, like M1.1's `loadPermissions`). The
   * engine subtracts SoD from this pool ({@link hasEligibleApprover}) to decide whether the step has an
   * eligible approver or must escalate to an admin override (M4.3, ADR-0009/0014).
   */
  const loadStepCandidates = async (
    handle: ReadHandle,
    roleId: string,
  ): Promise<ApproverCandidate[]> => {
    // pool = users holding the step's (active) role; then join each pool member's every active role's
    // grants. `pool` is a self-alias of user_roles so the pool membership and the grant expansion don't
    // collide on the same table.
    const pool = alias(userRoles, "pool_membership");
    const rows = await handle
      .select({
        userId: pool.userId,
        module: rolePermissions.module,
        canAdd: rolePermissions.canAdd,
        canEdit: rolePermissions.canEdit,
        canDelete: rolePermissions.canDelete,
        canView: rolePermissions.canView,
        canApprove: rolePermissions.canApprove,
      })
      .from(pool)
      .innerJoin(roles, and(eq(roles.id, pool.roleId), eq(roles.active, true)))
      .innerJoin(userRoles, eq(userRoles.userId, pool.userId))
      .innerJoin(rolePermissions, eq(rolePermissions.roleId, userRoles.roleId))
      .where(eq(pool.roleId, roleId));

    const byUser = new Map<string, typeof rows>();
    for (const row of rows) {
      const bucket = byUser.get(row.userId);
      if (bucket) bucket.push(row);
      else byUser.set(row.userId, [row]);
    }
    return Array.from(byUser, ([userId, grantRows]) => ({
      userId,
      permissions: expandGrants(grantRows),
    }));
  };

  /**
   * The M5.2 activation gate for a vendor: is every mandatory doc Verified? Composes the required set
   * (origin ∪ single-category, {@link requiredDocMasterIdsForVendor} — the same set the M5.3 reject→Draft
   * bounce reads, so the two never drift) then measures each slot's current-version verify state against
   * it. Pure judgement lives in `@vms/domain` ({@link activationGate}); this only gathers the data.
   * Reused by the `activate` block in `decide` and by `buildDetail` (so the console can show the gate
   * before an approver decides).
   */
  const computeActivationGate = async (
    handle: ReadHandle,
    vendorId: string,
  ): Promise<ActivationGate> => {
    // Required set = origin docs ∪ this category's docs (ADR-0013), composed from the matrix.
    const requiredDocMasterIds = await requiredDocMasterIdsForVendor(handle, vendorId);

    // Each slot's current version's verify state — a missing version (left-join null) reads as not-yet.
    const slotRows = await handle
      .select({
        documentMasterId: documentSlots.documentMasterId,
        currentVersionStatus: documentVersions.verifyStatus,
      })
      .from(documentSlots)
      .leftJoin(documentVersions, eq(documentVersions.id, documentSlots.currentVersionId))
      .where(eq(documentSlots.vendorId, vendorId));
    const docs: VerifiableDocument[] = slotRows.map((s) => ({
      documentMasterId: s.documentMasterId,
      currentVersionStatus: s.currentVersionStatus ?? null,
    }));

    return activationGate(requiredDocMasterIds, docs);
  };

  /** Assemble the detail DTO (request row + ordered steps). `null` if the request is gone. */
  const buildDetail = async (
    handle: ReadHandle,
    requestId: string,
  ): Promise<ApprovalRequestDetailDTO | null> => {
    const row = await loadRequest(handle, requestId);
    if (!row) return null;
    const steps = await loadSteps(handle, requestId);
    const current = steps.find((s) => s.stepNo === row.currentStepNo);
    // Registration requests carry the activation gate (M5.2); an edit request has nothing to activate.
    const gate = isEditTrigger(row.trigger)
      ? null
      : await computeActivationGate(handle, row.subjectVendorId);
    return {
      id: row.id,
      subjectVendorId: row.subjectVendorId,
      vendorName: row.vendorName,
      trigger: row.trigger,
      status: row.status,
      currentStepNo: row.currentStepNo,
      currentStepRoleId: current?.roleId ?? null,
      currentStepRoleCode: current?.roleCode ?? null,
      currentStepRoleNameId: current?.roleNameId ?? null,
      currentStepRoleNameEn: current?.roleNameEn ?? null,
      currentAssigneeUserId: current?.assigneeUserId ?? null,
      currentAssigneeName: current?.assigneeName ?? null,
      submittedBy: row.submittedBy,
      createdAt: row.createdAt.toISOString(),
      routeId: row.routeId,
      resolvedAt: iso(row.resolvedAt),
      payload: row.payload ?? null,
      steps: steps.map((s) => ({
        stepNo: s.stepNo,
        roleId: s.roleId,
        roleCode: s.roleCode,
        roleNameId: s.roleNameId,
        roleNameEn: s.roleNameEn,
        assigneeUserId: s.assigneeUserId,
        assigneeName: s.assigneeName,
        decision: s.decision,
        decidedBy: s.decidedBy,
        decidedByName: s.decidedByName,
        reason: s.reason,
        decidedAt: iso(s.decidedAt),
        isOverride: s.isOverride,
      })),
      activationGate: gate,
    };
  };

  return {
    listOpen: async (filter) => {
      // An empty role set means "the caller holds no roles" → an empty role queue; short-circuit before
      // building an `IN ()` predicate (which some drivers reject).
      if (filter.roleIds && filter.roleIds.length === 0) return [];
      const conds = [eq(approvalRequests.status, "pending")];
      if (filter.vendorId) conds.push(eq(approvalRequests.subjectVendorId, filter.vendorId));
      if (filter.assigneeUserId) {
        conds.push(eq(approvalRequestSteps.assigneeUserId, filter.assigneeUserId));
      }
      if (filter.roleIds && filter.roleIds.length > 0) {
        // The current step's role (the leftJoin below is keyed on stepNo = currentStepNo) ∈ my roles.
        conds.push(inArray(approvalRequestSteps.roleId, [...filter.roleIds]));
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
          currentStepRoleNameId: roles.nameId,
          currentStepRoleNameEn: roles.nameEn,
          currentAssigneeUserId: approvalRequestSteps.assigneeUserId,
          currentAssigneeName: users.name,
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
        .leftJoin(users, eq(users.id, approvalRequestSteps.assigneeUserId))
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
        currentStepRoleNameId: r.currentStepRoleNameId,
        currentStepRoleNameEn: r.currentStepRoleNameEn,
        currentAssigneeUserId: r.currentAssigneeUserId,
        currentAssigneeName: r.currentAssigneeName,
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

        // Separation of duties + escalation (M4.3, ADR-0009/0014) — gate the acting *approve* decision.
        // Reject is unrestricted (returning to Draft concentrates no duty); only approve advances/activates.
        let isOverride = false;
        if (input.decision === "approve") {
          const decider: ApproverCandidate = {
            userId: input.deciderUserId ?? "",
            permissions: input.deciderPermissions,
          };
          const sod = {
            submitterUserId: row.submittedBy,
            verifierUserIds: await loadVendorVerifiers(tx, row.subjectVendorId),
          };
          // SoD on the decider: submitter (no self-approval) / verifier (verifier ≠ approver) → 403.
          const ineligibility = approverIneligibility(decider, sod, APPROVE_PERMISSION);
          if (ineligibility === "self-approval") return { ok: false, reason: "self_approval" };
          if (ineligibility === "verifier") return { ok: false, reason: "verifier" };
          // Escalation: if the step's role has no eligible approver, only an admin override may resolve it.
          const candidates = await loadStepCandidates(tx, current.roleId);
          if (!hasEligibleApprover(candidates, sod, APPROVE_PERMISSION)) {
            if (!hasOverrideAuthority(decider)) return { ok: false, reason: "override_required" };
            isOverride = true;
          }
        }

        const outcome = applyDecision(row.currentStepNo, steps.length, input.decision, row.trigger);
        const now = new Date();

        // 0. Activation gate (M5.2, ADR-0013): a registration final-approve may only activate once every
        // mandatory doc is Verified. Check *before* any write, so a blocked gate leaves the request wholly
        // untouched (no step recorded, still Pending) — the approver retries after the docs are verified.
        // Runs after the SoD gate above: an ineligible approver is turned away on eligibility alone and
        // never learns the gate's state.
        if (outcome.subjectEffect === "activate") {
          const gate = await computeActivationGate(tx, row.subjectVendorId);
          if (!gate.ok) return { ok: false, reason: "gate_blocked", gate };
        }

        // 1. Record the decision on the current step (flagging an admin override, ADR-0014).
        await tx
          .update(approvalRequestSteps)
          .set({
            decision: input.decision === "approve" ? "approved" : "rejected",
            decidedBy: input.deciderUserId,
            reason: input.reason,
            decidedAt: now,
            isOverride,
            updatedAt: now,
          })
          .where(
            and(
              eq(approvalRequestSteps.requestId, input.requestId),
              eq(approvalRequestSteps.stepNo, row.currentStepNo),
            ),
          );

        // 2. Advance to the next step (auto-assign its role's lead, ADR-0012) or resolve the request.
        let nextAssignment: StepAssignment | null = null;
        if (outcome.advanceToStepNo !== null) {
          const next = steps.find((s) => s.stepNo === outcome.advanceToStepNo);
          nextAssignment = {
            assigneeUserId: next?.leadUserId ?? null,
            roleNameId: next?.roleNameId ?? null,
            roleNameEn: next?.roleNameEn ?? null,
          };
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

        // 3. Apply the subject effect (ADR-0005). Registration: final approve → vendor Active; reject →
        // Draft. Edit (M4.5): final approve → apply the diff to the still-Active vendor + clear the flag;
        // reject → discard the diff + clear the flag (the vendor is untouched either way).
        let officeInviteEmail: string | null = null;
        if (outcome.subjectEffect === "activate") {
          // The M5.2 gate above already cleared this activation (all mandatory docs Verified).
          await tx
            .update(vendors)
            .set({ status: "active", updatedAt: now })
            .where(eq(vendors.id, row.subjectVendorId));
          // An office-registered vendor has no user (M3.6 links no owner) — activation is the moment
          // it earns one, so mint the account here, in the same tx: a vendor must never be able to
          // reach Active with no way for anyone to claim it. The invite email goes out after commit.
          if (row.vendorSource === "office") {
            const provisioned = await provisionOfficeOwner(tx, row.subjectVendorId, ctx.locale);
            if (provisioned.status === "provisioned") {
              officeInviteEmail = provisioned.email;
              await writeAudit(tx, ctx, {
                action: "vendor.owner_provisioned",
                module: "vendors",
                subjectType: "vendor",
                subjectId: row.subjectVendorId,
              });
            } else if (provisioned.status === "no-contact") {
              // Not fatal: the decision is sound and the record is correct — but nobody can be
              // invited, so say so loudly rather than let the vendor go live unclaimable in silence.
              console.error(
                "[office-invite] activated office vendor has no PIC or company email",
                row.subjectVendorId,
              );
            }
          }
        } else if (outcome.subjectEffect === "return_to_draft") {
          await tx
            .update(vendors)
            .set({ status: "draft", updatedAt: now })
            .where(eq(vendors.id, row.subjectVendorId));
        } else if (outcome.subjectEffect === "apply_change") {
          await applyVendorChange(tx, ctx, row.subjectVendorId, row.payload);
        } else if (outcome.subjectEffect === "discard_change") {
          await discardVendorChange(tx, ctx, row.subjectVendorId);
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
        // An admin override bypassed the step's normal eligible-approver role — trace it distinctly (ADR-0014).
        if (isOverride) {
          await writeAudit(tx, ctx, {
            action: "approval_request.overridden",
            module: MODULE,
            subjectType: "approval_request",
            subjectId: input.requestId,
          });
        }
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
        return {
          ok: true,
          detail,
          notices: {
            // Only a **registration** resolution is the vendor's news. An edit (M4.5) is staff
            // re-approving a change on a record that stays Active throughout — the vendor's own
            // lifecycle didn't move, and the catalogue scopes `decision` to registrations.
            decision:
              isEditTrigger(row.trigger) || outcome.requestStatus === "pending"
                ? null
                : { outcome: outcome.requestStatus },
            nextAssignment,
            officeInviteEmail,
          },
        };
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

    rolesForUser: async (userId) => {
      const rows = await dbHandle
        .select({ roleId: userRoles.roleId })
        .from(userRoles)
        .innerJoin(roles, eq(roles.id, userRoles.roleId))
        .where(and(eq(userRoles.userId, userId), eq(roles.active, true)));
      return rows.map((r) => r.roleId);
    },

    candidatesForStep: async (requestId, stepNo) => {
      // The step's role, then the active users who hold it — the pool a delegate/reassign may pick from.
      const [step] = await dbHandle
        .select({ roleId: approvalRequestSteps.roleId })
        .from(approvalRequestSteps)
        .where(
          and(
            eq(approvalRequestSteps.requestId, requestId),
            eq(approvalRequestSteps.stepNo, stepNo),
          ),
        )
        .limit(1);
      if (!step) return [];
      const rows = await dbHandle
        .select({ userId: users.id, name: users.name, email: users.email })
        .from(userRoles)
        .innerJoin(users, eq(users.id, userRoles.userId))
        .where(and(eq(userRoles.roleId, step.roleId), eq(users.active, true)))
        .orderBy(asc(users.name));
      return rows.map((r) => ({ userId: r.userId, name: r.name, email: r.email }));
    },
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
 * Deliver everything a committed decision owes the outside world (M6.2, ADR-0012): the vendor hears
 * the registration verdict, the next approver hears the step landed on them, and a newly-provisioned
 * office owner gets the link that lets them in.
 *
 * Ordered so the office invite comes last, and deliberately: it's the only one carrying a credential
 * link, so it's the one whose absence a vendor would actually be stuck on.
 */
const dispatchDecisionNotices = async (
  ctx: RequestContext,
  detail: ApprovalRequestDetailDTO,
  notices: DecideNotices,
  reason: string | null,
): Promise<void> => {
  const reader = notificationReader();
  if (notices.decision) {
    await notifyDecision(reader, {
      vendorId: detail.subjectVendorId,
      vendorName: detail.vendorName,
      outcome: notices.decision.outcome,
      reason,
      // An approved vendor lands on their record; a rejected one lands where the work is — the
      // registration they now have to fix. Both live in the portal, which is the vendor's world.
      url: `${env.portalUrl}/registration`,
    });
  }
  if (notices.nextAssignment) {
    await notifyStepAssigned(reader, {
      assigneeUserId: notices.nextAssignment.assigneeUserId,
      vendorName: detail.vendorName,
      roleLabel: {
        nameId: notices.nextAssignment.roleNameId,
        nameEn: notices.nextAssignment.roleNameEn,
      },
      url: `${env.consoleUrl}/approvals`,
    });
  }
  if (notices.officeInviteEmail) {
    // Mints a password-set token and mails it as the invite — see `auth.ts`, which recognises the
    // link and sends `office_invite` rather than a bare "reset your password".
    await sendOfficeInvite(notices.officeInviteEmail);
  }
};

/**
 * Build the `/console/approvals` engine router. `GET /` is the queue (open requests; `?mine=1` scopes to
 * the caller's assigned steps, `?vendorId=` to one vendor); `GET /:id` the detail; `POST /:id/approve`
 * and `/:id/reject` decide; `POST /:id/steps/:stepNo/reassign` delegates a step. Gated on `approvals`,
 * every mutation audited. Mount under the authenticated `/console` prefix (request-context middleware).
 */
export const approvalRoutes = (store: ApprovalStore = drizzleApprovalStore()): Hono<AppEnv> => {
  const app = new Hono<AppEnv>();

  // The queue. `?mine=1` → steps assigned to me; `?role=1` → steps routed to a role I hold (the shared
  // team inbox — I can see and pick up work the auto-assignment put on a colleague); `?vendorId=` → one
  // vendor. `mine` and `role` compose (an assigned-to-me *and* my-role filter); with neither, the whole
  // open queue. A `?role=1` caller with no session or no roles gets an empty queue (deny-by-default).
  app.get("/", requirePermission(MODULE, "view"), async (c) => {
    const actor = c.var.ctx.actor;
    const roleIds = c.req.query("role")
      ? actor
        ? await store.rolesForUser(actor.userId)
        : []
      : undefined;
    const filter: QueueFilter = {
      vendorId: c.req.query("vendorId") || undefined,
      assigneeUserId: c.req.query("mine") ? (actor?.userId ?? undefined) : undefined,
      roleIds,
    };
    return c.json({ items: await store.listOpen(filter) });
  });

  app.get("/:id", requirePermission(MODULE, "view"), async (c) => {
    const item = await store.getDetail(c.req.param("id"));
    return item ? c.json({ item }) : sendError(c, notFoundError());
  });

  // The delegate/reassign picker's candidate pool — active users who hold the step's role. Gated on
  // `approve` (only someone who can decide reassigns), so it never leaks the directory to a viewer.
  app.get("/:id/steps/:stepNo/candidates", requirePermission(MODULE, "approve"), async (c) => {
    const stepNo = Number.parseInt(c.req.param("stepNo"), 10);
    if (!Number.isInteger(stepNo) || stepNo < 1) return sendError(c, validationError());
    return c.json({ items: await store.candidatesForStep(c.req.param("id"), stepNo) });
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
      deciderPermissions: c.var.ctx.actor?.permissions ?? toPermissionSet([]),
      decision,
      reason,
    });
    if (!outcome.ok) {
      switch (outcome.reason) {
        case "not_found":
          return sendError(c, notFoundError());
        case "not_pending":
          return sendError(c, conflictError({ messageKey: "error.approval.notPending" }));
        case "self_approval":
          return sendError(c, forbiddenError({ messageKey: "error.approval.selfApproval" }));
        case "verifier":
          return sendError(c, forbiddenError({ messageKey: "error.approval.verifierConflict" }));
        case "override_required":
          return sendError(c, forbiddenError({ messageKey: "error.approval.overrideRequired" }));
        // M5.2: a registration final-approve blocked because not every mandatory doc is Verified — a 409
        // carrying the localized "N of M verified" + the outstanding master ids (details).
        case "gate_blocked":
          return sendError(c, activationGateError(outcome.gate));
      }
    }
    // The decision has committed — everything below is the outside world being told about it, after
    // the fact and never inside the transaction (M6.2, ADR-0012). Each of these swallows its own
    // failures: the decision stands whether or not the mail gets through.
    await dispatchDecisionNotices(c.var.ctx, outcome.detail, outcome.notices, reason);
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
