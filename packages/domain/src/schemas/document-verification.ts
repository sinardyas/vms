/**
 * Compliance-document **verification** — the verifier-side Zod inputs + the pure decidability predicate
 * (M5.1, #68, ADR-0007/0013/0014).
 *
 * The counterpart to the capture block ({@link ./vendor-document}): capture records *which* doc type and
 * the file; **verification** is the Document Verifier's decision on an uploaded version — verify (entering
 * or confirming the certificate's issue/expiry dates) or reject (with a reason). Split into its own file
 * for the same reason capture and the submit-gate are ({@link ./vendor-submit}): a distinct concern with
 * a distinct consumer (the M5.1 `documents` API surface), shared verbatim with the M5.4 console screen so
 * both agree on what a verify/reject payload looks like and when a version may still be decided.
 *
 * What lives here vs the DB: the store owns `verifiedBy`/`verifiedAt` (identity + clock, not user input);
 * this schema owns only what the verifier *types* — the dates on verify, the reason on reject. The
 * activation gate (M5.2) and the reject→Draft + re-upload versioning (M5.3) read the resulting verify
 * state but are not expressed here.
 */

import { z } from "zod";
import type { VerifyStatus } from "../values/enums";

/** A calendar date as the `date` columns store it — `YYYY-MM-DD`. Lexicographic order = chronological. */
const dateStr = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "expected an ISO date (YYYY-MM-DD)");

/**
 * The dates the verifier enters or confirms when verifying a version (ADR-0007/0010). Both are optional —
 * some gated docs are perpetual (e.g. NPWP has no expiry), and `validityDays` on the Document Master is a
 * hint, not a rule. When both are given, expiry must not precede issue.
 */
export const verifyDocumentInput = z
  .object({
    issuedOn: dateStr.optional(),
    expiresOn: dateStr.optional(),
  })
  .refine((v) => !(v.issuedOn && v.expiresOn) || v.expiresOn >= v.issuedOn, {
    message: "expiresOn must not precede issuedOn",
    path: ["expiresOn"],
  });
export type VerifyDocumentInput = z.infer<typeof verifyDocumentInput>;

/** The reason a verifier rejects a version (required — a reject always carries its why, ADR-0005/0007). */
export const rejectDocumentInput = z.object({
  reason: z.string().trim().min(1).max(1000),
});
export type RejectDocumentInput = z.infer<typeof rejectDocumentInput>;

/**
 * True when a version may still be verified or rejected — i.e. its decision is still `pending`. A decided
 * version is **terminal**: correcting a rejected (or superseded) document means uploading a *new* version,
 * which starts `pending` again (M5.3), never re-deciding a settled one. The single source of that rule for
 * both the API guard and the console's enable/disable of the verify/reject controls.
 */
export const isVersionDecidable = (verifyStatus: VerifyStatus): boolean =>
  verifyStatus === "pending";
