/**
 * Vendor compliance-document block — the shared Zod + capture-completeness predicate (M3.3, #44,
 * ADR-0011/0013).
 *
 * The single source of truth for what a gated document *version* looks like at capture and for when a
 * vendor's document set is *complete*, imported by three consumers so they agree byte-for-byte: the
 * **API** (validates the upload metadata per version), the **portal** capture screen (M3.5, client-side
 * pre-check), and the **submit gate** (M3.4), which runs the required doc set through
 * {@link missingRequiredDocuments} before a registration may leave Draft.
 *
 * Two things live apart on purpose, mirroring the bank block ({@link ./vendor-bank}):
 *   - **Structural** shape — {@link vendorDocumentVersionInput}: the fields typed *beside* an upload.
 *   - **Completeness** — a pure predicate so the *same* rule surfaces both here and in the M3.4 gate.
 *
 * What capture does and does NOT record: a version carries only *which* doc type, the file, and its
 * reference/variant numbers. The certificate **issue/expiry dates and the verify status are entered at
 * verification (M5), not at capture** (ADR-0010) — so they are deliberately absent from this schema.
 *
 * Bytes go through the same MinIO validation surface as bank attachments (mime ∈ pdf/jpeg/png, ≤10 MiB,
 * ADR-0013) — the storage seam's `validateAttachment` owns that, so it is not re-expressed here.
 */

import { z } from "zod";
import { uuidSchema } from "./common";

/** A trimmed, non-empty, length-capped string (matches a `varchar(max)` column). */
const str = (max: number) => z.string().trim().min(1).max(max);

/**
 * The capture-time metadata for one uploaded document version. `documentMasterId` says which gated doc
 * type this fills; `refNo`/`variant` are the numbers typed beside the file. No dates or verify fields —
 * those are the verifier's at M5 (see the file header). The file id itself rides outside this schema
 * (it comes from the multipart upload), exactly as bank attachments do.
 */
export const vendorDocumentVersionInput = z.object({
  documentMasterId: uuidSchema, // which gated doc type (document_master) this version fills
  refNo: str(120).optional(), // cert / registration no. — No. NPWP / SIUP / NIB / deed no. (drift #4 P0)
  variant: str(60).optional(), // doc sub-variant — Jenis Akta: Pendirian / Perubahan Nama … (drift #4 P1)
});
export type VendorDocumentVersionInput = z.infer<typeof vendorDocumentVersionInput>;

/* ── Capture-completeness, as a pure predicate (the single source the M3.4 submit gate runs) ─────── */

/**
 * One document slot as the submit gate sees it: which doc type, and whether it currently holds an
 * uploaded version. A slot with no version is a required-but-not-yet-supplied document.
 */
export type CapturedDocument = {
  readonly documentMasterId: string;
  readonly hasCurrentVersion: boolean;
};

/** True when the slot holds at least one uploaded version — the capture-completeness unit. */
export const documentCaptured = (slot: CapturedDocument): boolean =>
  slot.hasCurrentVersion === true;

/**
 * The required doc types still missing a captured version. The **required set itself** is `origin docs ∪
 * category docs` (ADR-0013) — computed by the M3.4 gate from the requirements matrix, not here — so this
 * takes it as input and returns which of those ids have no uploaded version yet. Returning the ids (not a
 * bool) lets the gate name exactly what's blocking submission. Duplicates in the input are collapsed.
 */
export const missingRequiredDocuments = (
  requiredDocMasterIds: readonly string[],
  captured: readonly CapturedDocument[],
): string[] => {
  const filled = new Set(captured.filter(documentCaptured).map((c) => c.documentMasterId));
  return [...new Set(requiredDocMasterIds)].filter((id) => !filled.has(id));
};

/** True when every required doc type has a captured version — the gate's go/no-go on the doc block. */
export const documentsComplete = (
  requiredDocMasterIds: readonly string[],
  captured: readonly CapturedDocument[],
): boolean => missingRequiredDocuments(requiredDocMasterIds, captured).length === 0;
