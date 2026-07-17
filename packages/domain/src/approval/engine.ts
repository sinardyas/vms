/**
 * Approval engine — the pure decision core (M4.2, ADR-0005/0012).
 *
 * The stack-neutral state machine the M4 workflow runs on: given where a request sits (its current
 * step out of the total the route resolved) and the decision an approver just made, it says what
 * happens next — does the request advance, resolve, and what effect (if any) lands on the subject.
 *
 * One config-driven mechanism serves every trigger (ADR-0005): a route is an ordered list of approver
 * roles; a request walks them one step at a time. **Approve** advances to the next step, or — on the
 * final step — resolves the request `approved` and applies the subject effect (a registration's vendor
 * becomes `active`, subject to the M5 activation gate). **Reject** at any step resolves the request
 * `rejected` and returns the subject to where it came from with reasons (ADR-0005/0014) — `Draft` for a
 * registration, still `Inactive` for a reactivation.
 *
 * Side-effect-free and DB-free — no Drizzle, no Hono. The API store (`apps/api/approval-route.ts`)
 * loads the request + its steps, calls {@link applyDecision}, and writes the outcome in one transaction;
 * separation-of-duties on *who* may decide is layered on top by M4.3 ({@link approverIneligibility}),
 * not here — this module only computes *what the decision does*.
 */

import type { ApprovalTrigger } from "../values/enums";

/** What an approver did to the current step. */
export type ApprovalDecision = "approve" | "reject";

/**
 * The three families of trigger the engine drives, which decide what a final approve / a reject *means*:
 *   - **Registration** (`new_vendor_registration`, `office_vendor_registration`) — the subject is a Draft
 *     vendor becoming Active; final approve **activates** it, reject returns it to Draft (ADR-0005).
 *   - **Reactivation** (`reactivation`, M6.4) — registration-like on approve (the subject lands Active,
 *     gate and all), but *not* on reject: see {@link isReactivationTrigger}.
 *   - **Edit** (`bank_change`, `non_bank_change`) — the subject is an *already-Active* vendor whose live
 *     record is untouched while a proposed **diff** rides on the request (ADR-0005/0010, M4.5); final
 *     approve **applies** the diff, reject **discards** it — either way the vendor stays Active.
 *
 * An edit trigger is exactly a post-activation change (bank or non-bank); everything else lands the
 * subject Active on final approve.
 */
export const isEditTrigger = (trigger: ApprovalTrigger): boolean =>
  trigger === "bank_change" || trigger === "non_bank_change";

/**
 * Is this the Inactive→Active reactivation trigger (M6.4, ADR-0009)?
 *
 * It shares the registration family's *approve* path — final approve activates the subject, gated by M5.2
 * exactly as a first activation is, because a vendor that went dormant may hold lapsed documents. It
 * parts company on *reject*: a registration falls back to `Draft`, but a reactivation's subject was
 * **Inactive**, and Draft means "an unsubmitted registration". Sending a refused, established vendor
 * there would recast a dormant record as an unfinished one and push it back through
 * `new_vendor_registration`. A declined reactivation simply leaves the vendor Inactive
 * ({@link SubjectEffect} `keep_inactive`) — free to be raised again.
 */
export const isReactivationTrigger = (trigger: ApprovalTrigger): boolean =>
  trigger === "reactivation";

/** The effect a decision lands on the request's subject (e.g. the vendor under registration). */
export type SubjectEffect =
  /** No subject change — the request advanced to a further step. */
  | "none"
  /** Registration/reactivation final approval — activate the subject (vendor → `active`, subject to M5). */
  | "activate"
  /** Registration rejection — return the subject to `Draft` with reasons (resumable). */
  | "return_to_draft"
  /** Reactivation rejection (M6.4) — the subject stays `Inactive`; nothing to write, reasons recorded. */
  | "keep_inactive"
  /** Edit final approval (M4.5) — apply the request's diff to the (still-Active) subject, clear the flag. */
  | "apply_change"
  /** Edit rejection (M4.5) — discard the request's diff; the subject is unchanged, clear the flag. */
  | "discard_change";

/** The resolved status a decision leaves on the {@link ApprovalRequest}. */
export type RequestStatus = "pending" | "approved" | "rejected";

/** What {@link applyDecision} says happens next — drives the store's single-transaction write. */
export type DecisionOutcome = {
  /** The request's status after this decision (`pending` while more steps remain). */
  readonly requestStatus: RequestStatus;
  /** The effect to apply to the subject, if any. */
  readonly subjectEffect: SubjectEffect;
  /**
   * The step to open next — assign its role's lead (ADR-0012) — or `null` when the decision resolved
   * the request (final approve / any reject).
   */
  readonly advanceToStepNo: number | null;
  /** Whether this decision resolved the request (no further steps will be acted on). */
  readonly resolved: boolean;
};

/**
 * Compute the outcome of `decision` taken on step `currentStepNo` of a `totalSteps`-step route for a
 * request of the given `trigger`. The trigger decides what resolution *means* ({@link isEditTrigger},
 * {@link isReactivationTrigger}):
 *
 * - **Reject** (any step) → request `rejected`, resolved. Registration → subject returns to Draft;
 *   reactivation → subject stays Inactive (`keep_inactive`); edit → the diff is discarded
 *   (`discard_change`), the Active subject unchanged.
 * - **Approve** a non-final step → request stays `pending`, advance to the next step (no subject effect).
 * - **Approve** the final step → request `approved`, resolved. Registration *and* reactivation → subject
 *   `activate`; edit → the diff is applied to the still-Active subject (`apply_change`).
 *
 * `currentStepNo` is 1-based and assumed in `[1, totalSteps]` (the caller only decides an open step of
 * a pending request). `totalSteps` is the route's resolved step count (≥ 1).
 */
export const applyDecision = (
  currentStepNo: number,
  totalSteps: number,
  decision: ApprovalDecision,
  trigger: ApprovalTrigger,
): DecisionOutcome => {
  const edit = isEditTrigger(trigger);
  if (decision === "reject") {
    return {
      requestStatus: "rejected",
      subjectEffect: edit
        ? "discard_change"
        : isReactivationTrigger(trigger)
          ? "keep_inactive"
          : "return_to_draft",
      advanceToStepNo: null,
      resolved: true,
    };
  }
  const isFinalStep = currentStepNo >= totalSteps;
  if (isFinalStep) {
    return {
      requestStatus: "approved",
      subjectEffect: edit ? "apply_change" : "activate",
      advanceToStepNo: null,
      resolved: true,
    };
  }
  return {
    requestStatus: "pending",
    subjectEffect: "none",
    advanceToStepNo: currentStepNo + 1,
    resolved: false,
  };
};

/** One planned step of a request: its 1-based position and the role that decides it. */
export type PlannedStep = {
  readonly stepNo: number;
  readonly roleId: string;
};

/**
 * Turn a route's ordered approver roles into the request's steps (1-based `stepNo` from array order),
 * mirroring how the Approval-Routes editor derives step numbers (`approval-routes-service`). The store
 * inserts these when it opens a request; step 1 is then auto-assigned to its role's lead (ADR-0012).
 */
export const planSteps = (routeRoleIds: readonly string[]): PlannedStep[] =>
  routeRoleIds.map((roleId, i) => ({ stepNo: i + 1, roleId }));
