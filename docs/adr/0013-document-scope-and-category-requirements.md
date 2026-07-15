# ADR-0013: Document scope & category requirements

- **Status:** Accepted
- **Date:** 2026-07-13
- **Deciders:** (project owner), Claude

## Decisions

### Single category per vendor
`vendor.category_id` (one Klasifikasi). The required-document set is `origin docs ∪ that category's docs`.

### Category → documents = M:N requirements matrix
- `document_master` type carries `applies_to` (origin: local|foreign|both) and `mandatory` (origin-level).
- A separate **`category_document_requirements`** join maps `(category_id, doc_no, mandatory)` — a doc type
  may be required by many categories; a category may require many doc types.
- **Gated required set for a vendor** =
  `{ doc_master : applies_to ⊇ origin ∧ mandatory }` **∪**
  `{ doc via category_document_requirements(vendor.category) : mandatory }`.
  Activation (ADR-0007/0009) requires all of these `Verified`.

### Only compliance docs are gated Documents
- **Gated Documents** (Document Master, verified, versioned, count toward the gate): NPWP, Akta/SK, SMK3,
  ISO, category licenses (BBM, SIUPPAK), COR/Form DGT, W-8BEN-E, etc.
- **Attachments (validated, NOT gated, NOT verifier-reviewed):**
  - Bank-proof files on `vendor_bank`: buku tabungan / account proof; and when `holderSameAsCompany = false`,
    **KTP-of-holder + surat pernyataan** (presence enforced by the bank invariant, ADR-0007 context / ADR-0005).
  - **Signed payment-terms** template on the vendor's payment-terms record.
- Attachments are stored in MinIO like any file, but flow through **validation rules**, not the verification
  queue or the activation gate.

## Consequences

- Tables: `document_master`, `category_document_requirements`, `document_slots` + `document_versions`
  (ADR-0011) for gated docs; bank/terms attachments are `file_id` columns on their owner rows.
- The Document Verifier's queue contains only compliance documents — smaller, sharper.
- The gate query is a set-difference: required(origin,category) − verified. Surfacing "what's blocking
  activation" is a direct read.
