/**
 * Post-activation change requests — raising / reading / cancelling a vendor edit (M4.5, #60,
 * ADR-0005/0009/0010).
 *
 * An Active vendor's record is frozen (M4.4): its profile/banks/documents can't be written in place.
 * Instead an edit is **raised** here as an ApprovalRequest carrying the proposed diff on its `payload`,
 * routed by kind (ADR-0009 — a **bank** change → AP Manager, a **non-bank** change → AP Supervisor), while
 * a `change_pending` flag guards the live record. The diff is applied (or discarded) only when the
 * approval engine resolves the request (`vendor-change.ts`, run in the decide tx of `approval-route.ts`).
 *
 * Three endpoints under `/vendors/:vendorId/change-requests` (RBAC `vendors`; own-vendor scoping is the
 * index.ts ownership middleware, as for the bank/document sub-routers):
 *   - `POST /` — raise a change. Guards: the vendor must be **Active**; a non-bank diff may not drop the
 *     profile below its per-origin required set ({@link missingProfileFields}); a bank diff's per-account
 *     out-of-country **remark** rule is checked with the vendor's country in hand (the block's primary +
 *     holder-proof invariants are already enforced by the shared Zod). The one-pending-change lock
 *     (ADR-0010) rejects a second concurrent change with a friendly 409.
 *   - `GET /current` — the vendor's open change (kind + status + the proposed diff), for the portal to
 *     show "your change is under review" without the `approvals` grant the console approver has.
 *   - `POST /cancel` — the submitter withdraws the change **pre-decision** (ADR-0010), clearing the flag;
 *     the vendor stays Active. After the first step decision, change goes through an approver's rejection.
 *
 * Every mutation writes its audit row in the same transaction as the change it records.
 */

import { type DB, approvalRequestSteps, approvalRequests, db as defaultDb, vendors } from "@vms/db";
import {
  type Origin,
  type RequestContext,
  type VendorChangeInput,
  type VendorChangeKind,
  type VendorStatus,
  bankCountryRemarkRequired,
  changeTrigger,
  conflictError,
  invariantError,
  isRecallable,
  missingProfileFields,
  notFoundError,
  parseWith,
  validationError,
  vendorChangeInput,
} from "@vms/domain";
import { and, eq } from "drizzle-orm";
import { type Context, Hono } from "hono";
import { isOnePendingChange, openApprovalRequest } from "./approval-engine";
import { writeAudit } from "./audit";
import type { AppEnv } from "./context";
import { sendError } from "./http-error";
import { requirePermission } from "./rbac";

/** Change requests gate on the `vendors` module (the record being edited); ownership is scoped separately. */
const MODULE = "vendors" as const;

/** The live vendor facts a change is validated against — its lifecycle state, origin, and own country. */
export type VendorChangeRef = {
  readonly id: string;
  readonly status: VendorStatus;
  readonly origin: Origin;
  readonly countryId: string | null;
};

/** A raised change as the portal/console reads it — the kind, its route progress, and the proposed diff. */
export type ChangeRequestDTO = {
  readonly requestId: string;
  readonly kind: VendorChangeKind;
  readonly trigger: string;
  readonly status: string;
  readonly currentStepNo: number;
  readonly payload: VendorChangeInput | null;
  readonly createdAt: string;
};

/** Raising a change: opened (with its request id), or blocked by the one-pending-change lock (ADR-0010). */
export type CreateChangeOutcome =
  | { readonly ok: true; readonly requestId: string }
  | { readonly ok: false; readonly reason: "change_pending" };

/** Cancelling a change: withdrawn, none open to withdraw, or review has already started (post-decision). */
export type CancelChangeOutcome = "cancelled" | "none" | "already_decided";

/**
 * The data-access seam behind the router — every DB touch, so the surface is testable without Postgres.
 * `create`/`cancel` are transactional + atomically audited; `getVendor`/`current` feed the guards + read.
 */
export type VendorChangeStore = {
  readonly getVendor: (vendorId: string) => Promise<VendorChangeRef | null>;
  readonly create: (
    ctx: RequestContext,
    vendorId: string,
    change: VendorChangeInput,
  ) => Promise<CreateChangeOutcome>;
  readonly current: (vendorId: string) => Promise<ChangeRequestDTO | null>;
  readonly cancel: (ctx: RequestContext, vendorId: string) => Promise<CancelChangeOutcome>;
};

/* ── The real Drizzle store ────────────────────────────────────────────────────────────────────── */

/** The kind of an edit request from its trigger (the inverse of {@link changeTrigger}). */
const kindOfTrigger = (trigger: string): VendorChangeKind =>
  trigger === "bank_change" ? "bank" : "non_bank";

export const drizzleVendorChangeStore = (dbHandle: DB = defaultDb): VendorChangeStore => ({
  getVendor: async (vendorId) => {
    const [row] = await dbHandle
      .select({
        id: vendors.id,
        status: vendors.status,
        origin: vendors.origin,
        countryId: vendors.countryId,
      })
      .from(vendors)
      .where(eq(vendors.id, vendorId))
      .limit(1);
    return row ?? null;
  },

  create: (ctx, vendorId, change) =>
    dbHandle.transaction(async (tx): Promise<CreateChangeOutcome> => {
      // Flag the record, then open the routed request carrying the diff — both in one tx, so a tripped
      // one-pending lock (below) rolls the flag back too. The vendor's Active status is untouched: an
      // edit re-approves on top of the live values, which stay live until the diff is applied.
      await tx
        .update(vendors)
        .set({ changePending: true, updatedAt: new Date() })
        .where(eq(vendors.id, vendorId));
      try {
        const { requestId } = await openApprovalRequest(tx, ctx, {
          vendorId,
          trigger: changeTrigger(change.kind),
          submitterUserId: ctx.actor?.userId ?? null,
          payload: change,
        });
        await writeAudit(tx, ctx, {
          action: "vendor.change_requested",
          module: MODULE,
          subjectType: "vendor",
          subjectId: vendorId,
        });
        return { ok: true, requestId };
      } catch (error) {
        // The vendor already carries an open request (registration or another change) — ADR-0010 lock.
        if (isOnePendingChange(error)) return { ok: false, reason: "change_pending" };
        throw error;
      }
    }),

  current: async (vendorId) => {
    const [row] = await dbHandle
      .select({
        requestId: approvalRequests.id,
        trigger: approvalRequests.trigger,
        status: approvalRequests.status,
        currentStepNo: approvalRequests.currentStepNo,
        payload: approvalRequests.payload,
        createdAt: approvalRequests.createdAt,
      })
      .from(approvalRequests)
      .where(
        and(eq(approvalRequests.subjectVendorId, vendorId), eq(approvalRequests.status, "pending")),
      )
      .limit(1);
    if (!row) return null;
    // Only bank/non-bank triggers are edits; a pending registration request (on a non-Active vendor)
    // isn't a "change" and has no diff to show here.
    if (row.trigger !== "bank_change" && row.trigger !== "non_bank_change") return null;
    const parsed = row.payload ? vendorChangeInput.safeParse(row.payload) : null;
    return {
      requestId: row.requestId,
      kind: kindOfTrigger(row.trigger),
      trigger: row.trigger,
      status: row.status,
      currentStepNo: row.currentStepNo,
      payload: parsed?.success ? parsed.data : null,
      createdAt: row.createdAt.toISOString(),
    };
  },

  cancel: (ctx, vendorId) =>
    dbHandle.transaction(async (tx): Promise<CancelChangeOutcome> => {
      // The vendor's open (pending) request — an Active vendor's is its in-flight edit (ADR-0010).
      const [request] = await tx
        .select({ id: approvalRequests.id, status: approvalRequests.status })
        .from(approvalRequests)
        .where(
          and(
            eq(approvalRequests.subjectVendorId, vendorId),
            eq(approvalRequests.status, "pending"),
          ),
        )
        .limit(1);
      if (!request) return "none";

      const stepRows = await tx
        .select({ decision: approvalRequestSteps.decision })
        .from(approvalRequestSteps)
        .where(eq(approvalRequestSteps.requestId, request.id));
      if (
        !isRecallable(
          request.status,
          stepRows.map((s) => s.decision),
        )
      ) {
        return "already_decided";
      }

      const now = new Date();
      await tx
        .update(approvalRequests)
        .set({ status: "recalled", resolvedAt: now, updatedAt: now })
        .where(eq(approvalRequests.id, request.id));
      // The vendor stays Active — an edit never changed its state; only the pending flag is cleared.
      await tx
        .update(vendors)
        .set({ changePending: false, updatedAt: now })
        .where(eq(vendors.id, vendorId));
      await writeAudit(tx, ctx, {
        action: "approval_request.recalled",
        module: "approvals",
        subjectType: "approval_request",
        subjectId: request.id,
      });
      await writeAudit(tx, ctx, {
        action: "vendor.change_cancelled",
        module: MODULE,
        subjectType: "vendor",
        subjectId: vendorId,
      });
      return "cancelled";
    }),
});

/* ── Route ─────────────────────────────────────────────────────────────────────────────────────── */

/** Parse a JSON body against the change diff union; malformed JSON → a localized 400, else a Result. */
const parseChangeBody = async (c: Context<AppEnv>) => {
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    return { ok: false as const, error: validationError() };
  }
  return parseWith(vendorChangeInput, raw);
};

/**
 * Business rules the shared Zod can't express (they need the live vendor, or are gate-owned policy). A
 * non-bank diff may not leave a required profile field empty (an Active vendor already met the set); a
 * bank diff must keep ≥1 account (the vendor stays payable — the same gate policy as submit) and every
 * out-of-country account needs a stated remark (ADR-0005). Returns a 422 error, or `null` when sound.
 */
const changeInvariant = (change: VendorChangeInput, vendor: VendorChangeRef) => {
  if (change.kind === "non_bank") {
    const missing = missingProfileFields(vendor.origin, change.profile);
    if (missing.length > 0) {
      return invariantError({ messageKey: "error.vendor.changeIncomplete", details: missing });
    }
    return null;
  }
  if (change.banks.length === 0) {
    return invariantError({ messageKey: "error.vendor.bankRequired" });
  }
  for (const bank of change.banks) {
    if (
      bankCountryRemarkRequired(bank.bankCountryId, vendor.countryId ?? undefined) &&
      !bank.differsFromCompanyRemark
    ) {
      return invariantError({ messageKey: "error.bank.countryRemarkRequired" });
    }
  }
  return null;
};

/**
 * Build the `/vendors/:vendorId/change-requests` router. The store is injectable so the surface is
 * testable without Postgres; RBAC gates the module verbs and the index.ts ownership middleware scopes a
 * vendor-kind caller to their own record. Mount at `/vendors` (handlers carry the `:vendorId` sub-paths).
 */
export const vendorChangeRoutes = (
  store: VendorChangeStore = drizzleVendorChangeStore(),
): Hono<AppEnv> => {
  const app = new Hono<AppEnv>();

  // Raise a post-activation edit → opens the routed approval request + flags the record.
  app.post("/:vendorId/change-requests", requirePermission(MODULE, "edit"), async (c) => {
    const vendor = await store.getVendor(c.req.param("vendorId"));
    if (!vendor) return sendError(c, notFoundError());
    // Only an Active vendor re-approves edits: a Draft edits in place, a Pending vendor is frozen under
    // its own registration review (M4.4). Anything else → 409 with the specific reason.
    if (vendor.status !== "active") {
      return sendError(c, conflictError({ messageKey: "error.vendor.notActive" }));
    }
    const parsed = await parseChangeBody(c);
    if (!parsed.ok) return sendError(c, parsed.error);
    const invariant = changeInvariant(parsed.value, vendor);
    if (invariant) return sendError(c, invariant);

    const outcome = await store.create(c.var.ctx, vendor.id, parsed.value);
    if (!outcome.ok) {
      return sendError(c, conflictError({ messageKey: "error.approval.changePending" }));
    }
    const item = await store.current(vendor.id);
    return item ? c.json({ item }, 201) : sendError(c, invariantError());
  });

  // The vendor's open change (if any) + its proposed diff — portal-scoped read.
  app.get("/:vendorId/change-requests/current", requirePermission(MODULE, "view"), async (c) => {
    const item = await store.current(c.req.param("vendorId"));
    return item ? c.json({ item }) : sendError(c, notFoundError());
  });

  // Submitter withdraws the change pre-decision (ADR-0010) → clears the flag; the vendor stays Active.
  app.post("/:vendorId/change-requests/cancel", requirePermission(MODULE, "edit"), async (c) => {
    const outcome = await store.cancel(c.var.ctx, c.req.param("vendorId"));
    if (outcome === "none") {
      return sendError(c, conflictError({ messageKey: "error.approval.notRecallable" }));
    }
    if (outcome === "already_decided") {
      return sendError(c, conflictError({ messageKey: "error.approval.recallAfterDecision" }));
    }
    return c.json({ ok: true });
  });

  return app;
};
