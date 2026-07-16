/**
 * Activation gate — the pure "may this registration activate?" predicate (M5.2, #69, ADR-0013/0014).
 *
 * The M4.2 approval engine's registration final-approve carries an `activate` subject effect ({@link
 * ./approval/engine}); this gate stands in front of it. A vendor may leave Pending for Active only when
 * **every mandatory document is Verified** — the verification counterpart to the M3.4 submit gate,
 * which only checked that each mandatory doc was *captured* ({@link ./vendor-submit}). It reuses the
 * same composed required set (origin ∪ single-category, ADR-0013, {@link requiredDocumentSet}) and
 * reads the per-version verify state M5.1 sets ({@link ./document-verification}).
 *
 * Pure and total: it never throws, returning the whole picture at once — the verified count and every
 * outstanding doc — so the approver sees "N of M verified" and exactly what's blocking, and M5.4
 * renders the same status on the vendor / approval detail. The API store composes the matrix + reads
 * the verify state; this module only judges.
 */

import { type DomainError, conflictError } from "../errors";
import type { VerifyStatus } from "../values/enums";

/**
 * One required document as the gate sees it: which doc type, and the verify status of its current
 * version (`null` when no version is captured — unreachable past the M3.4 submit gate, but modelled so
 * the predicate is total). Only `verified` clears the gate; `pending`/`rejected`/absent all block.
 */
export type VerifiableDocument = {
  readonly documentMasterId: string;
  readonly currentVersionStatus: VerifyStatus | null;
};

/**
 * The required doc types not yet Verified — the activation blockers. Takes the already-composed required
 * set ({@link requiredDocumentSet}) as input so the gate stays pure and the store owns the matrix query.
 * Returns the master ids (not a bool) so the caller can name exactly what's holding activation.
 * Duplicates in the input are collapsed.
 */
export const unverifiedMandatoryDocuments = (
  requiredDocMasterIds: readonly string[],
  docs: readonly VerifiableDocument[],
): string[] => {
  const verified = new Set(
    docs.filter((d) => d.currentVersionStatus === "verified").map((d) => d.documentMasterId),
  );
  return [...new Set(requiredDocMasterIds)].filter((id) => !verified.has(id));
};

/** The whole-gate verdict: `ok` when nothing is outstanding, plus the "N of M" counts + blockers. */
export interface ActivationGate {
  readonly ok: boolean;
  readonly requiredCount: number;
  readonly verifiedCount: number;
  /** Required master ids whose current version is not Verified — empty iff `ok`. */
  readonly blockers: readonly string[];
}

/**
 * The single answer to "may this registration activate?" — every mandatory doc judged against its
 * current version's verify state. `verifiedCount / requiredCount` is the "N of M verified" the UI and
 * the block error both show; `blockers` names the rest.
 */
export const activationGate = (
  requiredDocMasterIds: readonly string[],
  docs: readonly VerifiableDocument[],
): ActivationGate => {
  const required = [...new Set(requiredDocMasterIds)];
  const blockers = unverifiedMandatoryDocuments(required, docs);
  return {
    ok: blockers.length === 0,
    requiredCount: required.length,
    verifiedCount: required.length - blockers.length,
    blockers,
  };
};

/**
 * Collapse a blocked gate into the typed 409 the approval engine returns when final-approve can't
 * activate: a `conflict` {@link DomainError} keyed `error.approval.activationGateBlocked`, carrying the
 * "N of M" counts as interpolation params and the outstanding master ids as diagnostic `details`.
 */
export const activationGateError = (gate: ActivationGate): DomainError =>
  conflictError({
    messageKey: "error.approval.activationGateBlocked",
    params: { verified: gate.verifiedCount, required: gate.requiredCount },
    details: gate.blockers,
  });
