/**
 * Approval engine — request opening (M4.2/M4.5, ADR-0005/0009/0010/0012).
 *
 * The half of the engine that runs when a subject *raises a request*: resolve the route for the trigger
 * from the M2.4-seeded Approval Routes master, then create the {@link approvalRequests} row and its
 * ordered {@link approvalRequestSteps}, auto-assigning the first step to its role's lead (ADR-0012). One
 * opener serves every trigger (ADR-0005): a **registration** submit (Draft→Pending, no payload) and a
 * post-activation **edit** (M4.5 — an Active vendor's bank/non-bank change, whose proposed **diff** rides
 * on the request via `payload` and is applied only on final approval) both open a request the same way.
 *
 * It takes an open transaction handle rather than the ambient `db`, so the request opens **atomically
 * with the subject transition/flag that triggers it** — the vendor store's `submit` calls this inside the
 * same tx as the Draft→Pending update, and the change store inside the same tx as setting `change_pending`
 * — so a vendor can never reach Pending (or carry a change flag) without its approval request, and a
 * failure here rolls the caller back. Kept free of any import of the vendor or approval routers, so
 * wiring it into those stores creates no cycle.
 *
 * The *decisions* on an open request (approve/advance/reject/reassign, and the M4.5 diff apply/discard
 * effects) live in `approval-route.ts`; this module only opens the request.
 */

import {
  type DB,
  approvalRequestSteps,
  approvalRequests,
  approvalRouteSteps,
  approvalRoutes,
  roles,
} from "@vms/db";
import type { ApprovalTrigger, RequestContext } from "@vms/domain";
import { and, asc, eq } from "drizzle-orm";
import { writeAudit } from "./audit";

/** An open Drizzle transaction handle — what the caller's `db.transaction(async (tx) => …)` yields. */
export type Tx = Parameters<Parameters<DB["transaction"]>[0]>[0];

/**
 * The one-pending-change lock tripped (ADR-0010): the subject already has an open (`pending`) request, so
 * a second can't be opened until it resolves. Thrown by {@link openApprovalRequest} (both the
 * pre-check and, as a race backstop, the `approval_requests_one_pending_per_vendor_uq` unique violation);
 * the caller catches it via {@link isOnePendingChange} and surfaces a friendly 409 rather than a raw 500.
 */
export class OnePendingChangeError extends Error {
  constructor(readonly vendorId: string) {
    super(`vendor "${vendorId}" already has a pending approval request`);
    this.name = "OnePendingChangeError";
  }
}

/** Type guard — did opening a request trip the one-pending-change lock? */
export const isOnePendingChange = (error: unknown): error is OnePendingChangeError =>
  error instanceof OnePendingChangeError;

/** A Postgres unique-violation on the one-pending-per-vendor partial index (the race backstop). */
const isOnePendingConflict = (error: unknown): boolean => {
  const e = error as { code?: string; constraint_name?: string } | null;
  if (!e || e.code !== "23505") return false;
  const constraint = e.constraint_name ?? "";
  return (
    constraint.includes("one_pending_per_vendor") ||
    String(error).includes("approval_requests_one_pending_per_vendor_uq")
  );
};

/**
 * What opening a request needs: the subject vendor, the trigger to route on, who submitted it, and — for
 * a post-activation **edit** (M4.5) — the proposed `payload` (diff) to persist on the request and apply
 * only on final approval. Registration opens carry no payload.
 */
export type OpenRequestInput = {
  readonly vendorId: string;
  readonly trigger: ApprovalTrigger;
  readonly submitterUserId: string | null;
  readonly payload?: Record<string, unknown>;
};

/**
 * Open an ApprovalRequest for `input` inside the transaction `tx`: resolve the active route for the
 * trigger, insert the request (with the edit diff on `payload`, if any) + its ordered steps, assign step 1
 * to its role's lead, and audit the opening. Returns the new request id.
 *
 * Throws if no active route (or no steps) is configured for the trigger — a seeding/config invariant
 * (the M2.4 seed guarantees one route per trigger), so it rolls the caller's transaction back rather than
 * stranding a subject with no workflow.
 */
export const openApprovalRequest = async (
  tx: Tx,
  ctx: RequestContext,
  input: OpenRequestInput,
): Promise<{ requestId: string }> => {
  const [route] = await tx
    .select({ id: approvalRoutes.id })
    .from(approvalRoutes)
    .where(and(eq(approvalRoutes.trigger, input.trigger), eq(approvalRoutes.active, true)))
    .limit(1);
  if (!route) {
    throw new Error(`no active approval route configured for trigger "${input.trigger}"`);
  }

  // The route's ordered steps, each with its role's designated lead (ADR-0012 auto-dispatch target).
  const routeSteps = await tx
    .select({
      stepNo: approvalRouteSteps.stepNo,
      roleId: approvalRouteSteps.roleId,
      leadUserId: roles.leadUserId,
    })
    .from(approvalRouteSteps)
    .innerJoin(roles, eq(roles.id, approvalRouteSteps.roleId))
    .where(eq(approvalRouteSteps.routeId, route.id))
    .orderBy(asc(approvalRouteSteps.stepNo));
  if (routeSteps.length === 0) {
    throw new Error(`approval route for trigger "${input.trigger}" has no steps`);
  }

  // One-pending-change lock (ADR-0010): a subject can carry at most one open request. Pre-check for a
  // clear error, with the partial unique index as the race backstop below — an active vendor with a
  // change in flight (M4.5) can't open another, and a registration can't double-open.
  const [existingPending] = await tx
    .select({ id: approvalRequests.id })
    .from(approvalRequests)
    .where(
      and(
        eq(approvalRequests.subjectVendorId, input.vendorId),
        eq(approvalRequests.status, "pending"),
      ),
    )
    .limit(1);
  if (existingPending) throw new OnePendingChangeError(input.vendorId);

  let request: { id: string } | undefined;
  try {
    [request] = await tx
      .insert(approvalRequests)
      .values({
        subjectVendorId: input.vendorId,
        trigger: input.trigger,
        status: "pending",
        payload: input.payload ?? null,
        routeId: route.id,
        currentStepNo: 1,
        submittedBy: input.submitterUserId,
      })
      .returning({ id: approvalRequests.id });
  } catch (error) {
    if (isOnePendingConflict(error)) throw new OnePendingChangeError(input.vendorId);
    throw error;
  }
  if (!request) throw new Error("approval request insert returned no row");

  // Step 1 opens now → assign its role's lead; later steps are assigned when they open (on advance).
  await tx.insert(approvalRequestSteps).values(
    routeSteps.map((s) => ({
      requestId: request.id,
      stepNo: s.stepNo,
      roleId: s.roleId,
      assigneeUserId: s.stepNo === 1 ? s.leadUserId : null,
    })),
  );

  await writeAudit(tx, ctx, {
    action: "approval_request.opened",
    module: "approvals",
    subjectType: "approval_request",
    subjectId: request.id,
  });

  return { requestId: request.id };
};
