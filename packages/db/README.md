# @vms/db — Drizzle schema (Phase 0)

Postgres schema for Soechi VMS Phase 0 (vendor registration + master data), encoding the decisions in
[`../../docs/adr`](../../docs/adr). TypeScript + Drizzle ORM; `casing: "snake_case"`.

## Layout
```
src/
  index.ts            postgres-js client (`db`, `DB`) + re-exports schema
  schema/
    enums.ts          Postgres enums for closed sets (ADR-0015)
    _shared.ts        timestamps / active-flag column groups
    auth.ts           users + better-auth companion tables (ADR-0004/0015)
    rbac.ts           roles(+lead) · role_permissions (9 modules × 5 verbs) · user_roles (ADR-0011/0012)
    master-data.ts    all 16 master lists + document_master + category_document_requirements + approval routes
    files.ts          MinIO file metadata (ADR-0008)
    vendors.ts        vendors · vendor_sub_users · vendor_banks · vendor_bank_currencies
    documents.ts      document_slots + document_versions (gated compliance docs, versioned)
    approvals.ts      approval_requests + approval_request_steps (workflow spine)
    notifications.ts  in-app / email notification records (ADR-0012)
    audit.ts          append-only action log (ADR-0011)
    relations.ts      Drizzle relations for the core aggregates
drizzle/              generated migrations (0000_phase0_init.sql) — committed
```

## Commands
```bash
npm install
npm run typecheck        # tsc --noEmit  (green)
npm run generate         # drizzle-kit generate  → drizzle/*.sql
npm run migrate          # apply to $DATABASE_URL
npm run studio           # drizzle-kit studio
```
`DATABASE_URL` defaults to `postgres://vms:vms@localhost:5432/vms`.

## Load-bearing constraints (don't lose these in refactors)
| Constraint | Enforces | ADR |
|---|---|---|
| `vendors_tax_id_non_draft_uq` — partial unique `WHERE status <> 'draft' AND tax_id IS NOT NULL` | Tax-ID unique among non-Draft; Drafts may collide, caught at submit | 0004, 0010 |
| `vendor_banks_one_primary_uq` — partial unique `WHERE is_primary` | exactly one Bank Utama per vendor | 0005 |
| `approval_requests_one_pending_per_vendor_uq` — partial unique `WHERE status = 'pending'` | one pending change at a time per vendor | 0010 |
| `cat_doc_req_uq` (category_id, document_master_id) | the M:N category→document requirements matrix | 0013 |
| `role_permissions_role_module_uq` (role_id, module) | one permission row per (role, module) | 0011 |

## Not enforced by the DB (belongs in `packages/domain`)
- **Approval authority** = route role **AND** module `approve` permission, minus **SoD** (verifier≠approver,
  no self-approval), with zero-eligible **escalation** (ADR-0009/0011/0014).
- **Activation gate**: all mandatory docs (origin ∪ category) `verified` before Active (ADR-0013/0014).
- **Bank invariants**: holder≠company ⇒ KTP + surat; bank-country≠vendor-country ⇒ remark (ADR-0013).
- **Freeze / recall / reject→Draft**, document-reject→Draft (ADR-0010/0014).
- `document_slots.current_version_id` is a soft pointer (no hard FK) to avoid a circular slot⇄version
  constraint — integrity maintained in app code.

## Status
`tsc --noEmit` clean · `drizzle-kit generate` produces `drizzle/0000_phase0_init.sql`
(33 tables, 13 enums, 23 unique indexes, 44 FKs). Not yet applied to a database.
