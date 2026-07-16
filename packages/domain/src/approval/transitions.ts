/**
 * Registration lifecycle transitions — freeze + recall predicates (M4.4, #59, ADR-0010/0014).
 *
 * The pure rules governing *when* a vendor under registration may be changed, layered on top of the
 * M4.2 decision core ({@link applyDecision}). Two invariants live here, stack-neutral and DB-free so the
 * portal, the console, and the API store all read the same bar:
 *
 *   1. **Freeze (ADR-0014)** — Draft is the only editable state. The moment a vendor is submitted it
 *      becomes `pending`/`pending_hod` and its profile, banks, and documents are *immutable*; to change
 *      anything the submitter recalls (below) or an approver rejects — either returns it to Draft. So
 *      {@link isCaptureEditable} gates every capture mutation (profile PUT, bank/doc writes) to Draft.
 *
 *   2. **Recall (ADR-0010)** — the submitter may withdraw a Pending request, but only *before any
 *      decision is recorded*: once the first step is approved (or the request rejected), "what was
 *      approved is what you get" takes over and change goes through a reject instead. {@link isRecallable}
 *      encodes that window — the request is still `pending` and no step carries a decision.
 *
 * The one-pending-change lock (an active vendor with a change in flight can't open another, ADR-0010) is
 * enforced at the persistence edge by the `approval_requests_one_pending_per_vendor_uq` partial index and
 * the API opener's pre-check — it needs to see existing rows, so it isn't a pure predicate here.
 */

import type { ApprovalStatus, StepDecision, VendorStatus } from "../values/enums";

/**
 * May a vendor's capture data (profile, banks, documents) be edited in its current state? Only while it
 * is a **Draft** (ADR-0014: submit freezes the record). Every capture mutation gates on this so the
 * portal and the office console can never disagree on what's editable — and a Pending/Active vendor's
 * submitted snapshot stays immutable for the verifiers and approvers acting on it.
 */
export const isCaptureEditable = (status: VendorStatus): boolean => status === "draft";

/**
 * May the submitter recall (withdraw) this request back to Draft? Only in the **pre-decision** window
 * (ADR-0010): the request is still `pending` *and* no step has been decided yet. Advancing past step 1
 * records the prior step's `approved` decision, so a decided step closes the window — after that, change
 * requires a reject (→ Draft with reasons), preserving "what was approved is what you get".
 *
 * `stepDecisions` is the request's steps' decisions in any order; an empty list (no steps) is treated as
 * undecided, so a freshly-opened request is recallable.
 */
export const isRecallable = (
  requestStatus: ApprovalStatus,
  stepDecisions: readonly StepDecision[],
): boolean => requestStatus === "pending" && stepDecisions.every((d) => d === "pending");
