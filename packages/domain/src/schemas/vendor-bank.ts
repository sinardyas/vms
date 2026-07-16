/**
 * Vendor bank-account block — the shared Zod + invariants (M3.2, #43, ADR-0013/0005/0007).
 *
 * The single source of truth for what a vendor bank account looks like and when it's *complete*,
 * imported by three consumers so they agree byte-for-byte: the **API** (validates the capture body
 * and enforces the invariants per write), the **portal** capture screen (M3.5, client-side pre-check),
 * and the **submit gate** (M3.4), which runs the whole block through {@link vendorBankBlockSchema}
 * before a registration may leave Draft.
 *
 * Two kinds of rule live here, kept apart on purpose:
 *   - **Structural** shape — {@link vendorBankInput}: the fields + their caps, always checkable.
 *   - **Business invariants** — expressed as pure predicates so the *same* rule can surface as a
 *     per-write 422 in the API (where a single bank is saved) *and* as a block-level issue in the
 *     submit gate (where the whole set is validated). Nothing is duplicated: the predicate is the rule.
 *
 * The bank-country **remark** rule (`bank country ≠ vendor country ⇒ remark`) needs the vendor's own
 * country, which a lone bank payload doesn't carry — so it's a predicate ({@link bankCountryRemarkRequired})
 * the caller feeds the vendor country to, enforced at the API/gate, not inside the self-contained schema.
 */

import { z } from "zod";
import { uuidSchema } from "./common";

/** Attachment content types accepted for bank proof / KTP / surat pernyataan (validated, not gated). */
export const BANK_ATTACHMENT_MIMES = ["application/pdf", "image/jpeg", "image/png"] as const;
export type BankAttachmentMime = (typeof BANK_ATTACHMENT_MIMES)[number];
export const bankAttachmentMimeSchema = z.enum(BANK_ATTACHMENT_MIMES);

/** Max attachment size (10 MiB) — a scanned KTP / passbook page, never a large file (ADR-0013). */
export const BANK_ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024;

/** The three attachment slots on a bank account. `proof` is always optional; `ktp`/`surat` gate on holder. */
export const BANK_ATTACHMENT_SLOTS = ["proof", "ktp", "surat"] as const;
export type BankAttachmentSlot = (typeof BANK_ATTACHMENT_SLOTS)[number];
export const bankAttachmentSlotSchema = z.enum(BANK_ATTACHMENT_SLOTS);

/** A trimmed, non-empty, length-capped string (matches a `varchar(max)` column). */
const str = (max: number) => z.string().trim().min(1).max(max);

/**
 * The structural shape of one bank account as captured — every column on `vendor_banks` plus the M:N
 * `currencyIds`. Caps mirror the Drizzle schema. Conditional-required rules are NOT baked in here (they
 * are the predicates below), so this stays reusable for partial Draft saves and for the submit gate alike.
 */
export const vendorBankInput = z.object({
  bankId: uuidSchema.optional(), // resolved from the bank master where possible…
  bankName: str(200), // …else the entered name (always present)
  accountNo: str(60),
  holderName: str(240),
  branch: str(160).optional(),
  description: str(200).optional(), // bank "Deskripsi" field (drift-audit #4 P1)
  swift: str(16).optional(),
  iban: str(40).optional(),
  bankCountryId: uuidSchema.optional(),
  currencyIds: z.array(uuidSchema).min(1), // M:N — a bank account holds ≥1 currency
  isPrimary: z.boolean().optional(), // exactly-one Bank Utama per vendor (reconciled server-side)
  holderSameAsCompany: z.boolean(),
  differsFromCompanyRemark: str(500).optional(), // required when bank country ≠ vendor country
  proofFileId: uuidSchema.optional(), // buku tabungan / account proof
  ktpFileId: uuidSchema.optional(), // required when holder ≠ company
  suratPernyataanFileId: uuidSchema.optional(), // required when holder ≠ company
});
export type VendorBankInput = z.infer<typeof vendorBankInput>;

/* ── Business invariants, as pure predicates (the single source of each rule) ───────────────────── */

/** When the account holder is not the company itself, KTP-of-holder + surat pernyataan are required. */
export const holderProofRequired = (bank: { holderSameAsCompany: boolean }): boolean =>
  bank.holderSameAsCompany === false;

/** Which holder-proof attachments are still missing (empty flags when the holder *is* the company). */
export const missingHolderProof = (bank: {
  holderSameAsCompany: boolean;
  ktpFileId?: string;
  suratPernyataanFileId?: string;
}): { ktp: boolean; surat: boolean } =>
  holderProofRequired(bank)
    ? { ktp: !bank.ktpFileId, surat: !bank.suratPernyataanFileId }
    : { ktp: false, surat: false };

/** True when the holder differs from the company but at least one of KTP / surat is absent. */
export const holderProofIncomplete = (bank: {
  holderSameAsCompany: boolean;
  ktpFileId?: string;
  suratPernyataanFileId?: string;
}): boolean => {
  const m = missingHolderProof(bank);
  return m.ktp || m.surat;
};

/**
 * A remark is required when the bank's country differs from the vendor's own country (ADR-0005) — so
 * staff have a stated reason for an out-of-country account. Both ids must be known for the rule to bite;
 * an unset bank country (or unknown vendor country) doesn't trigger it.
 */
export const bankCountryRemarkRequired = (
  bankCountryId: string | undefined,
  vendorCountryId: string | undefined,
): boolean => !!bankCountryId && !!vendorCountryId && bankCountryId !== vendorCountryId;

/** Count of accounts flagged primary — the block is sound only when this is exactly 1 (given ≥1 bank). */
export const primaryCount = (banks: readonly { isPrimary?: boolean }[]): number =>
  banks.filter((b) => b.isPrimary === true).length;

/* ── The whole bank block — what the M3.4 submit gate runs before a vendor leaves Draft ──────────── */

/**
 * The complete bank block for a vendor: the array of accounts with the set-level + per-account business
 * invariants applied. The **remark** rule is intentionally absent (it needs the vendor country) — the
 * submit gate layers it on with the vendor's country in hand. Zero banks is allowed here (whether a
 * vendor *must* have a bank is an origin-level rule the gate owns), but when banks exist exactly one
 * must be primary and every holder-≠-company account must carry its KTP + surat.
 */
export const vendorBankBlockSchema = z.array(vendorBankInput).superRefine((banks, ctx) => {
  if (banks.length === 0) return;
  const primaries = primaryCount(banks);
  if (primaries !== 1) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `exactly one primary bank account is required (found ${primaries})`,
    });
  }
  banks.forEach((bank, i) => {
    const missing = missingHolderProof(bank);
    if (missing.ktp) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [i, "ktpFileId"],
        message: "KTP of the account holder is required when the holder is not the company",
      });
    }
    if (missing.surat) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [i, "suratPernyataanFileId"],
        message: "A surat pernyataan is required when the holder is not the company",
      });
    }
  });
});
