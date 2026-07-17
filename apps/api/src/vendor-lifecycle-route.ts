/**
 * Vendor service lifecycle — deactivate / raise a reactivation (M6.4, #80, ADR-0009/0010).
 *
 * The Inactive↔Active pair, the last transition the Phase-0 vendor state machine was missing. The two
 * directions are deliberately **asymmetric**, and that asymmetry is the whole design:
 *
 *   - **Deactivate (Active→Inactive)** is a *direct* act — no route, no approval. Taking a vendor out of
 *     service is reversible and conservative (the record is kept whole; only new transactions stop), so
 *     making it wait on an approval would buy nothing and stall the operational need it exists for. It is
 *     instead held narrow by permission: `vendors:delete`, which among the seeded roles (#21) only the
 *     System Administrator holds — the AP chain can *raise* a vendor's return but not unilaterally end it.
 *   - **Reactivate (Inactive→Active)** goes through the **AP-Manager route** (ADR-0009's fifth trigger,
 *     seeded at M2.4/#35), because putting a vendor *back* into service is the act with the compliance
 *     exposure: its documents may have lapsed while it was dormant. So this router only *raises* the
 *     request (`vendors:edit`, the whole AP chain); the engine decides it, and the M5.2 activation gate
 *     still has to clear before the final approve lands the vendor Active — the same bar as a first
 *     activation, deliberately (a dormant vendor's papers are exactly what nobody has been watching).
 *
 * Both are **staff-only** ({@link requireInternalActor}) rather than own-vendor-scoped: RBAC can't carry
 * that alone, because a vendor holds `vendors:delete`/`vendors:edit` on its own record for Draft
 * self-correction (#21). Ownership is the wrong warrant here — a vendor deactivating itself, or voting
 * itself back into service, is precisely what must not happen.
 *
 * Two endpoints under `/vendors/:vendorId`, each writing its audit row in the same transaction as the
 * transition it records:
 *   - `POST /deactivate` — Active→Inactive with a mandatory reason. Refuses (409) while an approval
 *     request is in flight: ADR-0010 allows one open request per vendor, and deactivating underneath it
 *     would leave approvers working a request against a vendor no longer in service.
 *   - `POST /reactivate` — opens the `reactivation` request. The one-pending lock is enforced by the
 *     opener, so a second raise gets the same friendly 409 as a double-raised change (M4.5).
 *
 * The *resolution* of a reactivation lives in `approval-route.ts`, not here — final approve rides the
 * shared `activate` effect, reject lands `keep_inactive` (the vendor stays Inactive rather than being
 * recast as an unfinished Draft).
 */

import { type DB, approvalRequests, db as defaultDb, vendors } from "@vms/db";
import {
  type RequestContext,
  type VendorStatus,
  canDeactivate,
  canReactivate,
  conflictError,
  invariantError,
  notFoundError,
  parseWith,
} from "@vms/domain";
import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { type StepAssignment, isOnePendingChange, openApprovalRequest } from "./approval-engine";
import { writeAudit } from "./audit";
import type { AppEnv } from "./context";
import { env } from "./env";
import { sendError } from "./http-error";
import { notificationReader, notifyStepAssigned } from "./notification-events";
import { requirePermission } from "./rbac";

/** Both acts are about the vendor record, so both gate on the `vendors` module (verbs differ — see below). */
const MODULE = "vendors" as const;

/** The live vendor facts a lifecycle act is validated against. */
export type VendorLifecycleRef = {
  readonly id: string;
  /** The vendor's display name — what the approver's `step_assigned` notification is *about* (M6.2). */
  readonly name: string;
  readonly status: VendorStatus;
};

/** Deactivating: done, or blocked because an approval request is still open on the vendor (ADR-0010). */
export type DeactivateOutcome =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: "request_pending" };

/** Raising a reactivation: opened (with its request id), or blocked by the one-pending lock (ADR-0010). */
export type ReactivateOutcome =
  | {
      readonly ok: true;
      readonly requestId: string;
      /** Step 1's auto-assignment, for the route to notify the AP Manager once this has committed (M6.2). */
      readonly assignment: StepAssignment;
    }
  | { readonly ok: false; readonly reason: "request_pending" };

/**
 * The data-access seam behind the router — every DB touch, so the surface is testable without Postgres.
 * `deactivate`/`reactivate` are transactional + atomically audited; `getVendor` feeds the guards.
 */
export type VendorLifecycleStore = {
  readonly getVendor: (vendorId: string) => Promise<VendorLifecycleRef | null>;
  readonly deactivate: (
    ctx: RequestContext,
    vendorId: string,
    reason: string,
  ) => Promise<DeactivateOutcome>;
  readonly reactivate: (ctx: RequestContext, vendorId: string) => Promise<ReactivateOutcome>;
};

/* ── Request bodies ────────────────────────────────────────────────────────────────────────────── */

/**
 * Deactivation carries a mandatory reason, landing on `vendors.inactive_reason`. Unlike a rejection's
 * reason (which the submitter reads and acts on), this one is written for whoever later has to judge the
 * reactivation: "lapsed", "contract concluded", and "pulled for cause" are the same Inactive status and
 * very different answers. `trim` before `min(1)` so whitespace can't satisfy the requirement.
 */
const deactivateBody = z.object({ reason: z.string().trim().min(1) });

/* ── The real Drizzle store ────────────────────────────────────────────────────────────────────── */

export const drizzleVendorLifecycleStore = (dbHandle: DB = defaultDb): VendorLifecycleStore => ({
  getVendor: async (vendorId) => {
    const [row] = await dbHandle
      .select({ id: vendors.id, name: vendors.name, status: vendors.status })
      .from(vendors)
      .where(eq(vendors.id, vendorId))
      .limit(1);
    return row ?? null;
  },

  deactivate: (ctx, vendorId, reason) =>
    dbHandle.transaction(async (tx): Promise<DeactivateOutcome> => {
      // An open request and a deactivation contradict each other: the request is a decision *about a
      // vendor in service*. Checked inside the tx so the read and the write agree on one snapshot.
      const [open] = await tx
        .select({ id: approvalRequests.id })
        .from(approvalRequests)
        .where(
          and(
            eq(approvalRequests.subjectVendorId, vendorId),
            eq(approvalRequests.status, "pending"),
          ),
        )
        .limit(1);
      if (open) return { ok: false, reason: "request_pending" };

      // The reason rides on the vendor, not the audit row: the log is an action log with no field
      // payloads (ADR-0011), so it can record *that* a vendor left service but never why.
      await tx
        .update(vendors)
        .set({ status: "inactive", inactiveReason: reason, updatedAt: new Date() })
        .where(eq(vendors.id, vendorId));
      await writeAudit(tx, ctx, {
        action: "vendor.deactivated",
        module: MODULE,
        subjectType: "vendor",
        subjectId: vendorId,
      });
      return { ok: true };
    }),

  reactivate: (ctx, vendorId) =>
    dbHandle.transaction(async (tx): Promise<ReactivateOutcome> => {
      try {
        // No payload: a reactivation proposes no diff — the record is already what it will be, the only
        // question is whether it may serve again. Contrast M4.5, where the diff *is* the request.
        const { requestId, assignment } = await openApprovalRequest(tx, ctx, {
          vendorId,
          trigger: "reactivation",
          submitterUserId: ctx.actor?.userId ?? null,
        });
        await writeAudit(tx, ctx, {
          action: "vendor.reactivation_requested",
          module: MODULE,
          subjectType: "vendor",
          subjectId: vendorId,
        });
        return { ok: true, requestId, assignment };
      } catch (error) {
        if (isOnePendingChange(error)) return { ok: false, reason: "request_pending" };
        throw error;
      }
    }),
});

/* ── The router ────────────────────────────────────────────────────────────────────────────────── */

export const vendorLifecycleRoutes = (
  store: VendorLifecycleStore = drizzleVendorLifecycleStore(),
): Hono<AppEnv> => {
  const app = new Hono<AppEnv>();

  // Deactivate gates on `vendors:delete` — the module's soft-delete verb (the M2.1 framework's
  // DELETE→inactive convention), held only by the System Administrator among the seeded roles (#21).
  app.post("/:vendorId/deactivate", requirePermission(MODULE, "delete"), async (c) => {
    const vendor = await store.getVendor(c.req.param("vendorId"));
    if (!vendor) return sendError(c, notFoundError());
    if (!canDeactivate(vendor.status)) {
      return sendError(c, conflictError({ messageKey: "error.vendor.notDeactivatable" }));
    }
    const parsed = parseWith(deactivateBody, await c.req.json().catch(() => ({})));
    if (!parsed.ok) {
      return sendError(c, invariantError({ messageKey: "error.vendor.deactivateReasonRequired" }));
    }

    const outcome = await store.deactivate(c.var.ctx, vendor.id, parsed.value.reason);
    if (!outcome.ok) {
      return sendError(c, conflictError({ messageKey: "error.vendor.deactivateChangePending" }));
    }
    return c.json({ ok: true });
  });

  // Raising a reactivation is an *edit* of the vendor's standing, not a deletion — so `vendors:edit`,
  // which the whole AP chain holds. The AP Manager route decides it; SoD bars the raiser from approving
  // their own raise (M4.3), and where that leaves the step with no eligible approver, M4.3's admin
  // override is the escape hatch (ADR-0014) — neither is this router's business.
  app.post("/:vendorId/reactivate", requirePermission(MODULE, "edit"), async (c) => {
    const vendor = await store.getVendor(c.req.param("vendorId"));
    if (!vendor) return sendError(c, notFoundError());
    if (!canReactivate(vendor.status)) {
      return sendError(c, conflictError({ messageKey: "error.vendor.notReactivatable" }));
    }

    const outcome = await store.reactivate(c.var.ctx, vendor.id);
    if (!outcome.ok) {
      return sendError(c, conflictError({ messageKey: "error.approval.changePending" }));
    }
    // After the commit, never inside it (M6.2): email can't be recalled from a rolled-back tx.
    await notifyStepAssigned(notificationReader(), {
      assigneeUserId: outcome.assignment.assigneeUserId,
      vendorName: vendor.name,
      roleLabel: {
        nameId: outcome.assignment.roleNameId,
        nameEn: outcome.assignment.roleNameEn,
      },
      url: `${env.consoleUrl}/approvals`,
    });
    return c.json({ requestId: outcome.requestId });
  });

  return app;
};
