/**
 * Vendor **submit gate** — the whole-aggregate completeness check (M3.4, #45, ADR-0004/0005/0007/0013).
 *
 * "Is this Draft submittable?" answered in exactly one place. The portal (M3.5) runs it to enable the
 * Submit button and mark what's outstanding; the office-registration API (M3.6) runs the *same* function
 * and turns a not-ready result into a 422 — so the two paths can never disagree on the bar (ADR-0004).
 *
 * It composes the three capture blocks built in M3.1/M3.2/M3.3, each already the single source of its
 * own rules, rather than restating them:
 *   - **profile** — the per-origin required-field set ({@link missingProfileFields}, {@link ./vendor}).
 *   - **banks** — at least one account, exactly one primary, holder-proof + out-of-country remark
 *     (the pure predicates from {@link ./vendor-bank}). *Whether a vendor must have a bank at all* is a
 *     submit-level policy the bank block deferred to here (its schema allows zero); the gate requires ≥1
 *     so an approved vendor is always payable.
 *   - **documents** — every mandatory doc type has a captured version ({@link missingRequiredDocuments},
 *     {@link ./vendor-document}), over the required set this module composes from the requirements matrix
 *     ({@link requiredDocumentSet}).
 *
 * The result is a structured {@link SubmitReadiness} — every blocker as its own issue with an i18n key,
 * a section, and a path — so the portal can render field-level feedback. {@link ensureVendorSubmittable}
 * collapses it to the `Result`/{@link DomainError} the API edge speaks (a single 422 carrying the issues
 * as diagnostic `details`). Same facts, two shapes.
 */

import type { DomainError } from "../errors";
import { invariantError } from "../errors";
import type { MessageKey } from "../i18n/keys";
import { type Result, err, ok } from "../result";
import type { DocAppliesTo, Origin } from "../values/enums";
import { type VendorProfileValues, isFieldPresent, missingProfileFields } from "./vendor";
import {
  type VendorBankInput,
  bankCountryRemarkRequired,
  holderProofIncomplete,
  primaryCount,
} from "./vendor-bank";
import { type CapturedDocument, missingRequiredDocuments } from "./vendor-document";

/* ── Required document set — composed from the requirements matrix (ADR-0013) ────────────────────── */

/** A `document_master` row as the composer reads it — just the fields that decide "is this mandatory here?". */
export interface DocumentMasterRule {
  readonly id: string;
  readonly appliesTo: DocAppliesTo; // local | foreign | both
  readonly mandatory: boolean; // origin-level mandatory flag
  readonly enabled: boolean; // disabled docs are not requested from vendors
}

/** A `category_document_requirements` row (× its `document_master`) — a category's own mandatory docs. */
export interface CategoryDocumentRule {
  readonly categoryId: string;
  readonly documentMasterId: string;
  readonly mandatory: boolean;
  readonly active: boolean; // the requirement row's soft-enable flag
  readonly enabled: boolean; // the referenced document_master's enabled flag
}

/**
 * The mandatory document types a vendor must supply = **origin docs ∪ its single category's docs**
 * (ADR-0013), deduplicated. Origin docs are enabled `document_master` rows flagged mandatory whose
 * `appliesTo` covers the vendor's origin (or `both`); category docs are the enabled + active mandatory
 * requirement rows for the vendor's category. A vendor with no category yet contributes no category
 * docs (that gap is caught as a missing *profile* field, not silently). Returns the master ids the
 * document-completeness check ({@link missingRequiredDocuments}) then measures the captured set against.
 */
export const requiredDocumentSet = (
  vendor: { readonly origin: Origin; readonly categoryId?: string | null },
  matrix: {
    readonly master: readonly DocumentMasterRule[];
    readonly categoryRequirements: readonly CategoryDocumentRule[];
  },
): string[] => {
  const originDocs = matrix.master
    .filter(
      (d) => d.enabled && d.mandatory && (d.appliesTo === vendor.origin || d.appliesTo === "both"),
    )
    .map((d) => d.id);

  const categoryDocs = vendor.categoryId
    ? matrix.categoryRequirements
        .filter((r) => r.categoryId === vendor.categoryId && r.enabled && r.active && r.mandatory)
        .map((r) => r.documentMasterId)
    : [];

  return [...new Set([...originDocs, ...categoryDocs])];
};

/* ── The readiness report — every blocker, keyed for the UI and mappable to a DomainError ────────── */

/** Which capture block a blocker belongs to — lets the portal route each issue to its section. */
export type SubmitSection = "profile" | "banks" | "documents";

/** One thing standing between a Draft and submission. `path` names the field / bank / doc it concerns. */
export interface SubmitIssue {
  readonly section: SubmitSection;
  /** Field code (`taxId`), bank pointer (`banks[0]`), or document-master id — what the UI highlights. */
  readonly path?: string;
  readonly messageKey: MessageKey;
  readonly params?: Readonly<Record<string, string | number>>;
}

/** The whole-aggregate verdict: submittable when `issues` is empty. */
export interface SubmitReadiness {
  readonly ok: boolean;
  readonly issues: readonly SubmitIssue[];
}

/**
 * Everything the gate needs, gathered by the caller: the vendor profile (a parsed Draft or a DB row),
 * its bank accounts, the composed required document set ({@link requiredDocumentSet}), and which slots
 * currently hold a version. Kept as plain data so the check stays pure and both consumers assemble it
 * the same way.
 */
export interface VendorSubmissionCandidate {
  readonly profile: VendorProfileValues & { readonly origin: Origin };
  readonly banks: readonly VendorBankInput[];
  readonly requiredDocMasterIds: readonly string[];
  readonly capturedDocuments: readonly CapturedDocument[];
}

/**
 * The single answer to "is this Draft submittable?" — profile, banks, and documents judged together.
 * Pure and total: it never throws, returning every blocker at once so the portal shows the full picture
 * in one pass rather than one-error-at-a-time.
 */
export const checkVendorSubmittable = (candidate: VendorSubmissionCandidate): SubmitReadiness => {
  const issues: SubmitIssue[] = [];

  // 1) Profile — the per-origin required-field set (ADR-0004).
  for (const field of missingProfileFields(candidate.profile.origin, candidate.profile)) {
    issues.push({ section: "profile", path: field, messageKey: "error.vendor.fieldRequired" });
  }

  // 2) Banks — ≥1 account, exactly one primary, and each account's own invariants (ADR-0005/0007).
  if (candidate.banks.length === 0) {
    issues.push({ section: "banks", messageKey: "error.vendor.bankRequired" });
  } else {
    const primaries = primaryCount(candidate.banks);
    if (primaries !== 1) {
      issues.push({
        section: "banks",
        messageKey: "error.vendor.bankPrimaryOne",
        params: { count: primaries },
      });
    }
    const vendorCountryId = candidate.profile.countryId ?? undefined;
    candidate.banks.forEach((bank, i) => {
      if (holderProofIncomplete(bank)) {
        issues.push({
          section: "banks",
          path: `banks[${i}]`,
          messageKey: "error.bank.holderProofRequired",
        });
      }
      if (
        bankCountryRemarkRequired(bank.bankCountryId, vendorCountryId) &&
        !isFieldPresent(bank.differsFromCompanyRemark)
      ) {
        issues.push({
          section: "banks",
          path: `banks[${i}]`,
          messageKey: "error.bank.countryRemarkRequired",
        });
      }
    });
  }

  // 3) Documents — every mandatory doc type has a captured version (ADR-0013).
  for (const docId of missingRequiredDocuments(
    candidate.requiredDocMasterIds,
    candidate.capturedDocuments,
  )) {
    issues.push({ section: "documents", path: docId, messageKey: "error.vendor.documentMissing" });
  }

  return { ok: issues.length === 0, issues };
};

/**
 * Collapse a not-ready verdict into the typed 422 the API edge returns: an `invariant`
 * {@link DomainError} keyed `error.vendor.notSubmittable`, with the individual issues riding along as
 * diagnostic `details` for a client that wants to render them field-by-field.
 */
export const submitReadinessError = (readiness: SubmitReadiness): DomainError =>
  invariantError({ messageKey: "error.vendor.notSubmittable", details: readiness.issues });

/**
 * The API-facing form of the gate: `ok(candidate)` when submittable, else `err(DomainError)` (422). The
 * portal typically calls {@link checkVendorSubmittable} directly for the full issue list; the office API
 * calls this to fail the submit with one mapped error.
 */
export const ensureVendorSubmittable = (
  candidate: VendorSubmissionCandidate,
): Result<VendorSubmissionCandidate, DomainError> => {
  const readiness = checkVendorSubmittable(candidate);
  return readiness.ok ? ok(candidate) : err(submitReadinessError(readiness));
};
