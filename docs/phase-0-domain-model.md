# Phase 0 Domain Model — Soechi VMS (Registration + Master Data)

Reflects ADR-0002…0007. `⛳ OPEN` = still under grilling. This is the shared picture that
`packages/domain` will encode.

## Aggregates

### Vendor (aggregate root)
```
Vendor
├─ id, origin(Local|Foreign), status(Draft|Pending|Pending-HOD|Active|Inactive|Blacklisted)
├─ source(self|office)
├─ identity : name, businessEntityId(→business_entities), categoryId(→vendor_categories),
│             taxId  // unique per origin (ADR-0004): local hard-unique, foreign unique-if-present
├─ profile  : address, city, postal, countryId(→countries), phone, fax, yearFounded, website, email
├─ people   : commissioner, director, pic{name, role, phone(WA), email}, soechiReference
├─ banks[]  → VendorBank
└─ documents[] → VendorDocument
```

### VendorBank
```
{ bankId(→banks), accountNo, holderName, branch, swift, iban?, currencyIds[](→currencies),
  isPrimary, holderSameAsCompany, ktpProofFileId?, suratPernyataanFileId?,
  bankCountryId(→countries), differsFromCompanyRemark? }
```
Invariants: exactly one `isPrimary` (Bank Utama); if `!holderSameAsCompany` ⇒ KTP + surat pernyataan
required; if `bankCountryId ≠ vendor.countryId` ⇒ remark required.

### VendorDocument
```
{ docTypeNo(→document_master), fileId, uploadedAt, verifyStatus(Pending|Verified|Rejected),
  verifiedBy?, verifiedAt?, rejectReason?, validUntil? }
```
Gate (ADR-0007): Vendor→Active requires every **mandatory** doc for its origin `Verified`.

### ApprovalRequest (workflow spine — ADR-0005)
```
{ subjectVendorId, trigger(NewVendorRegistration|BankChange|NonBankChange|Reactivation),
  payload|diff, routeId(→approval_routes), steps[]{role, decision, approver?, reason?, at?},
  currentStep, status(Pending|Approved|Rejected) }
```
Engine resolves route by `trigger`; step actionable by role + RBAC approve permission; final approval
applies the effect. Registration reject → Vendor back to Draft (reasons). Edit reject → diff discarded.

## Vendor state machine
```
signup+verify ─▶ Draft ─submit(self)▶ Pending ─AP approve*▶ Active ◀─HOD approve*─ Pending-HOD ◀─ office create
                   ▲                                          │  ▲
              reject(reasons)                    conclude/dormant│  │ Reactivation request (route→AP Mgr)
                   │                                            ▼  │
                Draft ◀──────────────────────────────────── Inactive
   *approve applies only if the doc-verification gate passes.
   Blacklist → deferred (needs Violations pillar).
```

## Actors & RBAC (ADR-0002 incl. Access)
AP Staff, AP Supervisor/Asst. Manager, AP Manager, HOD, Document Verifier, System Administrator; Vendor
sub-users. Permissions per module: add/edit/delete/view/approve. ⛳ enforcement depth + audit (round 4).

## Master data (all in Phase 0 — ADR-0002)
- **Registration lists:** business_entities, vendor_categories, banks, currencies, countries
- **document_master** (drives the required doc set + gate)
- **approval_routes** (drives the engine), users, roles, RBAC
- **soechi_entities** (new — group companies; ADR-0006), departments, vessels, ports, tax_codes, sla_thresholds
- Referential invariant: a Vendor field must reference an **active** master row at capture; deactivating a
  row hides it from new captures, never breaks existing vendors.

## Auth (ADR-0004)
Account-first: signup(email+pw)→email verify→session→resumable Draft. Self-user = Vendor's first sub-user.
Office path: staff create → invite email on HOD activation (⛳ confirm).

## Resolved (ADR-0008 … 0013)
- Storage = **MinIO** + `files`; localization = **bilingual ID+EN** with **per-locale label columns**
  (`name_id`/`name_en`) on master data.
- RBAC = **enforced server-side**, **grouped modules** (Vendors, Documents, Approvals, Registration-lists,
  Operational-lists, Approval Routes, Document Master, Access, Audit); approval = **route role AND approve
  permission** (deadlock guard required). Audit = **action-log only** (no field diffs).
- Approval requests = **named assignee** per step, **auto to role lead → delegate**; **submitter can recall**
  before any decision; edits on Active vendor stay Active, **one pending change at a time**.
- Routes = **2-step seed** (ADR-0009); office reg → HOD; SoD = **verifier≠approver** + **no self-approval**.
- Identity = Tax-ID **unique among non-Draft** (partial index); Drafts may collide, blocked at submit.
- Documents = **gated compliance docs only**, **versioned + current pointer**, vendor enters **real
  issue/expiry dates** (verifier confirms). Gate set = **origin ∪ single-category** via M:N
  `category_document_requirements`. Bank-proof/KTP/surat/terms = **validated attachments, not gated**.
- E-Proc = **deferred**. Notifications = verify-email, decision→vendor, doc-rejected→vendor,
  step-assigned→approver (+ office invite on activation). Sub-users = **single owner**.
- `roles.lead_user_id` added (auto-dispatch); `roles` also carry the RBAC that must match seeded routes.

## Remaining items = implementation defaults (override in review, not blockers)
- Auth library **better-auth** + email **SMTP/Resend**; Draft expiry **none (no auto-delete)**;
  enum storage (pg enums for status/origin/trigger/verify_status; lookup tables for master data);
  vendor short-code generation; in-app notification store for internal users.
