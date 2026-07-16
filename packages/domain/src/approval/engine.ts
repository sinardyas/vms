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
 * `rejected` and returns the subject to `Draft` with reasons (ADR-0005/0014), resumable.
 *
 * Side-effect-free and DB-free — no Drizzle, no Hono. The API store (`apps/api/approval-route.ts`)
 * loads the request + its steps, calls {@link applyDecision}, and writes the outcome in one transaction;
 * separation-of-duties on *who* may decide is layered on top by M4.3 ({@link approverIneligibility}),
 * not here — this module only computes *what the decision does*.
 */

/** What an approver did to the current step. */
export type ApprovalDecision = "approve" | "reject";

/** The effect a decision lands on the request's subject (e.g. the vendor under registration). */
export type SubjectEffect =
  /** No subject change — the request advanced to a further step. */
  | "none"
  /** Final approval — apply the trigger's effect (registration: vendor → `active`, subject to M5). */
  | "activate"
  /** Rejection — return the subject to `Draft` with reasons (resumable). */
  | "return_to_draft";

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
 * Compute the outcome of `decision` taken on step `currentStepNo` of a `totalSteps`-step route.
 *
 * - **Reject** (any step) → request `rejected`, subject returns to Draft, resolved.
 * - **Approve** a non-final step → request stays `pending`, advance to the next step (no subject effect).
 * - **Approve** the final step → request `approved`, subject effect `activate`, resolved.
 *
 * `currentStepNo` is 1-based and assumed in `[1, totalSteps]` (the caller only decides an open step of
 * a pending request). `totalSteps` is the route's resolved step count (≥ 1).
 */
export const applyDecision = (
  currentStepNo: number,
  totalSteps: number,
  decision: ApprovalDecision,
): DecisionOutcome => {
  if (decision === "reject") {
    return {
      requestStatus: "rejected",
      subjectEffect: "return_to_draft",
      advanceToStepNo: null,
      resolved: true,
    };
  }
  const isFinalStep = currentStepNo >= totalSteps;
  if (isFinalStep) {
    return {
      requestStatus: "approved",
      subjectEffect: "activate",
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
