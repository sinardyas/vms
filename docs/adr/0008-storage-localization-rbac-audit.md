# ADR-0008: Storage, localization, RBAC & audit

- **Status:** Accepted
- **Date:** 2026-07-13
- **Deciders:** (project owner), Claude

## Decisions

### File/document storage — MinIO (S3-compatible)
- Uploaded files (document scans, KTP, surat pernyataan, signed terms) live in **MinIO** (S3-compatible;
  same API in dev and prod). Postgres stores a `files` row (id, bucket/key, mime, size, checksum,
  uploadedBy) and business rows reference `fileId`. Access via short-lived **signed URLs** (respect RBAC).
- Validate mime/type & size on upload (align with the design's "PDF, JPG, PNG" constraints).

### Localization — bilingual (ID + EN) from day 1
- **i18n keyed from the start.** No hard-coded UI strings. Portal defaults **Bahasa** (foreign vendors
  may switch to **English**); Console supports EN/ID. Domain/enum values are stable codes; labels are
  translated. Server-generated text (emails, error messages) is localizable too.

### RBAC — enforced server-side
- Every API mutation checks the actor's **permission** (`add|edit|delete|view|approve` × module) derived
  from role → RBAC matrix. UI gating mirrors it but is not the control. Unauthorized ⇒ 403.

### Audit — full trail
- **Every mutation** (state change, master-data edit, approval decision, doc verify, login) writes an
  immutable audit record: `who, action, module, subject, before/after (or diff), at, ip/location, agent`.
  Backs the Console's Audit Trail tab. Append-only.

## Consequences

- `packages/domain` owns permission checks + audit-event emission so API and (future) jobs share them.
- MinIO + Postgres + (email provider) are the Phase-0 infra dependencies.

## Open

- **Auth library / email provider.** Recommendation: **better-auth** (sessions + email verification) on
  Bun+Hono; email via SMTP or a provider (Resend/SES). To confirm in a follow-up ADR.
