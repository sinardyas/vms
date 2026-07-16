/**
 * Approval engine — request opening at submit time (M4.2, ADR-0005/0009/0012).
 *
 * The half of the engine that runs when a subject is *submitted*: resolve the route for the trigger
 * from the M2.4-seeded Approval Routes master, then create the {@link approvalRequests} row and its
 * ordered {@link approvalRequestSteps}, auto-assigning the first step to its role's lead (ADR-0012).
 *
 * It takes an open transaction handle rather than the ambient `db`, so the request opens **atomically
 * with the subject transition that triggers it** — the vendor store's `submit` calls this inside the
 * same tx as the Draft→Pending update, so a vendor can never reach Pending without its approval request
 * (and a failure here rolls the transition back). Kept free of any import of the vendor or approval
 * routers, so wiring it into `vendor-route`'s store creates no cycle.
 *
 * The *decisions* on an open request (approve/advance/reject/reassign) live in `approval-route.ts`;
 * this module only opens the request. Separation-of-duties on who may later decide is M4.3.
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

/** What opening a request needs: the subject vendor, the trigger to route on, and who submitted it. */
export type OpenRequestInput = {
  readonly vendorId: string;
  readonly trigger: ApprovalTrigger;
  readonly submitterUserId: string | null;
};

/**
 * Open an ApprovalRequest for `input` inside the transaction `tx`: resolve the active route for the
 * trigger, insert the request + its ordered steps, assign step 1 to its role's lead, and audit the
 * opening. Returns the new request id.
 *
 * Throws if no active route (or no steps) is configured for the trigger — a seeding/config invariant
 * (the M2.4 seed guarantees one route per trigger), so it rolls the submit transaction back rather than
 * stranding a Pending subject with no workflow.
 */
export const openRegistrationRequest = async (
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

  const [request] = await tx
    .insert(approvalRequests)
    .values({
      subjectVendorId: input.vendorId,
      trigger: input.trigger,
      status: "pending",
      routeId: route.id,
      currentStepNo: 1,
      submittedBy: input.submitterUserId,
    })
    .returning({ id: approvalRequests.id });
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
