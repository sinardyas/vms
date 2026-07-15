# 003 — Prototype ↔ Phase-0 Schema Drift Audit

**Ticket:** [Reconcile prototype ↔ Phase-0 schema (drift audit) (#4)](https://github.com/sinardyas/vms/issues/4) · type `research` (AFK)
**Inputs:** `vendor_portal.html`, `staff_console.html` (Phase-0 sections) × `packages/db/src/schema/*`, `docs/phase-0-domain-model.md`, ADR-0002…0015.
**Date:** 2026-07-15

---

## Headline verdict

The committed Drizzle schema (33 tables) **covers the Phase-0 registration → approval → verification →
activation slice faithfully** — the aggregates, the state machine, the origin∪category document gate, the
bank invariants, and the workflow spine are all present and ADR-accurate. Drift is **narrow and mostly
additive**, not structural. Three buckets:

1. **Real schema gaps (must decide before M3 build)** — a handful of registration fields the portal
   captures that have no column, chiefly **tax/PKP status** and **document reference numbers**
   (NPWP no. / SIUP no. / NIB no.). ~6 fields. All additive; none invalidate existing tables.
2. **Which-wins conflicts (schema wins, prototype must be rebuilt to match)** — the prototype's **RBAC
   module matrix** (11 UI modules) and **role set** diverge from the settled ADR-0012 nine-module model
   and the domain-model actor list. The schema/ADR is the source of truth; the prototype UI is a mock.
3. **Scope flags (prototype shows MORE than Phase-0)** — Invoicing, POs & Contracts, Communications and
   Reports are built as **fully-functional real screens, NOT "coming soon" shells**, and the console
   carries a complete **Violations/Blacklist** flow (Phase 3). These are correctly *absent* from the
   schema; the drift is that the build must **down-scope these screens to shells**, per the destination.

**Recommendation:** apply the P0/P1 schema edits below during M2/M3 (the README authorises "update the
schema if drift is found" — proposed here, not applied blindly). The seed-consistency notes feed the
UAT seed-scenario design ([#10](https://github.com/sinardyas/vms/issues/10)).

---

## Coverage summary by area

| Area | Prototype surface | Schema | Verdict |
|---|---|---|---|
| Vendor identity / origin / status / source | Portal wizard step 1–2; console register modal; status badges | `vendors`, `vendorStatusEnum`, `originEnum`, `vendorSourceEnum` | ✅ Full — status badges match enum 1:1 |
| Vendor profile / people | Portal step 2; console Details tab | `vendors` profile+people columns | 🟡 Near-full — 2 optional fields missing (scale, procurement) + tax/PKP status gap |
| Tax / PKP status | Portal "Status Perpajakan" (required); SPPKP doc; NPWP sub-type | — (no column) | 🔴 **Gap** — no `vendors` tax-status field |
| Document reference numbers | Portal "No. NPWP / No. SIUP / No. NIB", deed type | `documentVersions` (no ref-no / variant field); `vendors.taxId` covers NPWP only | 🔴 **Gap** — SIUP/NIB numbers + deed type have no home |
| Gated documents / verification / gate | Portal step 3; console Document Verification | `documentMaster`, `categoryDocumentRequirements`, `documentSlots`, `documentVersions` | ✅ Full — origin∪category gate + versioning present |
| Banks / attachments | Portal step 4; console Bank tab + add-bank modal | `vendorBanks`, `vendorBankCurrencies` | 🟡 Near-full — `description` field missing (minor) |
| Payment terms + signed terms | Portal step 4 select + AP-terms upload | `paymentTermEnum`, `vendors.signedTermsFileId` | ✅ Full — enum matches exactly |
| Approval workflow | Console office-reg → HOD; approve/reject; routes master | `approvalRequests`, `approvalRequestSteps`, `approvalRoutes`, `approvalRouteSteps`, `approvalTriggerEnum` | ✅ Full (schema richer — models office trigger explicitly) |
| RBAC | Console Access matrix (11 modules × 5 verbs); roles list | `rbacModuleEnum` (9 modules), `roles`, `rolePermissions`, `userRoles` | ⚠️ **Conflict** — schema wins; matrix must be rebuilt to 9 modules |
| Master data (16 lists) | Console Administration | `master-data.ts` (all 16 tables) | ✅ Full — every list has a table (see seed notes for enum drift) |
| Audit | Console Audit Trail + Activity tab | `auditLog` | ✅ Full — action-log shape matches |
| Notifications | Portal/console badges, Communications channels | `notifications`, `notificationChannelEnum` | ✅ Full for Phase-0 events |
| Invoicing / PO / Comms / Reports | **Real screens** in both files | — (intentionally absent) | ⚠️ **Scope** — must ship as shells, not real screens |
| Violations / Blacklist | Console Violations tab, Report-violation modal, blacklist route | `vendorStatusEnum` has `blacklisted` only (unreachable Phase-0) | ⚠️ **Scope** — Phase 3; UI must be hidden/deferred |

---

## Gap table (detail)

Legend — **Verdict:** `GAP` schema needs a change · `SCHEMA-WINS` prototype must change · `SCOPE` prototype
exceeds Phase-0 · `SEED` reconcile in seed data, not schema · `OK` covered, no action.

### A. Vendor profile & identity

| Prototype element | Schema coverage | Verdict | Proposed change |
|---|---|---|---|
| Vendor origin (Local/Foreign) | `vendors.origin` + `originEnum` | OK | — |
| Status badges: Draft / Pending Verification / Pending HOD Approval / Active / Inactive / Blacklisted | `vendorStatusEnum` [draft, pending, pending_hod, active, inactive, blacklisted] | OK | 1:1 match. (`blacklisted` correctly unreachable in Phase-0.) |
| Company name, address, city, postal, country, phone, fax, year founded, website, company email | `vendors.name/address/city/postal/countryId/phone/fax/yearFounded/website/email` | OK | — |
| Commissioner, Director/Branch Head, PIC name/role/phone(WA)/email, Soechi reference | `vendors.commissioner/director/picName/picRole/picPhone/picEmail/soechiReference` | OK | — |
| Business Entity (datalist, required) | `vendors.businessEntityId` → `businessEntities` | OK | Portal renders a *free-type* datalist; enforce FK-to-active-master at submit (validation, not schema). |
| Klasifikasi / Classification (single) | `vendors.categoryId` → `vendorCategories` (single, ADR-0013) | OK | Portal shows 4; master has 15 — seed issue, not schema (see SEED-1). |
| **Status Perpajakan / Taxation Status** — PKP–Badan / PKP–Perorangan / Non-PKP–Badan / Non-PKP–Perorangan (**required**) | — none | **GAP** | **Add `vendors.taxStatus`** (pg enum `tax_status` = `pkp_corporate`,`pkp_individual`,`non_pkp_corporate`,`non_pkp_individual`) — or two columns `isPkp boolean` + `taxpayerType(corporate\|individual)`. Load-bearing: drives PPN eligibility and the SPPKP doc requirement. |
| **NPWP sub-type** — Personal / Head Office / Branch | — none | **GAP (minor)** | Fold into `taxStatus` (corporate/individual) or add `vendors.npwpType`. Confirm whether Head-Office/Branch matters in Phase-0; likely drop. |
| **Skala Perusahaan / Company Scale** ("Pilih Sesuai SIUP") | — none | **GAP (minor / decide)** | Add nullable `vendors.companyScale varchar` (Kecil/Menengah/Besar per SIUP), **or** confirm out-of-Phase-0 and drop from portal. Not marked required in prototype. |
| **Vendor Procurement** (portal step-2 field) | — none | **GAP (minor / decide)** | Purpose unclear from markup; likely an E-Proc classification. Confirm intent; drop if not Phase-0. |
| USER ID login (`VN-004182`, classic theme) | `users.email` is the username (ADR-0004) | SCHEMA-WINS | Email-first per ADR-0004; the USER-ID login is a prototype alt — drop it. `vendors.shortCode` still exists for display ("Vendor code"). |

### B. Documents (gated) & reference numbers

| Prototype element | Schema coverage | Verdict | Proposed change |
|---|---|---|---|
| Pakta Integritas, NPWP, SPPKP, SIUP/NIB, Akta, foreign set (COI, Form DGT, COR, AoA, Business License…) | `documentMaster` (DOC-000…020) + `documentSlots`/`documentVersions`; `docAppliesToEnum` origin applicability | OK | Seed the doc master rows (already sketched in console `DOC-*` seed). |
| Verify / Approve & set valid / Reject; per-doc validity; issue & expiry dates | `documentVersions.verifyStatus/verifiedBy/verifiedAt/rejectReason/issuedOn/expiresOn` + `verifyStatusEnum` | OK | Matches ADR-0007/0011 (versioned, current pointer, real dates). |
| Activation gate ("verify all documents to approve") | `documentSlots` × `categoryDocumentRequirements` set-difference | OK | Gate = required(origin∪category) − verified. Present. |
| Document requirement config (Mandatory/Optional), Applies (Both/Local/Foreign), Validity days, Reminder (Off/2wk/1mo) | `documentMaster.mandatory/appliesTo/validityDays/reminder` | OK | Enum values match exactly. |
| **"No. NPWP" / "No. SIUP" / "No. NIB"** — document reference numbers typed alongside uploads | `vendors.taxId` covers NPWP number only; SIUP/NIB numbers have **no column**; `documentVersions` has no ref-no field | **GAP** | **Add `documentVersions.refNo varchar(120)` (nullable)** to hold the certificate/registration number for any doc (generalises NPWP no., SIUP no., NIB no., deed no.). Keep `vendors.taxId` as the deduped identity key. |
| **Jenis Akta / Deed Type** (Pendirian / Perubahan Nama / Amendment) | — none | **GAP (minor)** | Add `documentVersions.variant varchar(60)` (nullable) for deed-type / doc sub-variant, **or** model deed variants as distinct `document_master` rows. Prefer `variant` (fewer master rows). |
| Declaration checkboxes ("documents are true", "this is Bank Utama") | — none (transient UI consent) | OK | No persistence needed; enforce at submit. (Optional: audit-log the consent event.) |
| Upload constraints (PDF/JPG, ≤2 MB) | `files.mime/sizeBytes` | OK | Validation rule, not schema. |

### C. Banks & attachments

| Prototype element | Schema coverage | Verdict | Proposed change |
|---|---|---|---|
| Bank name, account no., holder name, branch, SWIFT, IBAN, bank country, currency(s) | `vendorBanks.*` + `vendorBankCurrencies` (M:N) | OK | — |
| Bank Utama (exactly one primary) + "Set as main" | `vendorBanks.isPrimary` + partial unique index | OK | Invariant enforced in DB. |
| Holder same as company? → KTP + Surat Pernyataan when personal | `vendorBanks.holderSameAsCompany/ktpFileId/suratPernyataanFileId` | OK | Presence enforced by bank invariant (ADR-0013). |
| Bank-account proof (buku tabungan) | `vendorBanks.proofFileId` | OK | Validated attachment, not gated. |
| Bank-country-differs remark (conditional) | `vendorBanks.differsFromCompanyRemark` | OK | — |
| **Deskripsi / Description** (bank field, portal step 4) | — none | **GAP (minor)** | Add nullable `vendorBanks.description varchar(200)`, or reuse `differsFromCompanyRemark`. Low priority. |
| "Holder same as company" default | `vendorBanks.holderSameAsCompany default true` | OK | — |

### D. Payment terms

| Prototype element | Schema coverage | Verdict | Proposed change |
|---|---|---|---|
| Payment Terms select: Credit 30 / 45 / 60 / COD / Agent | `paymentTermEnum` [credit_30, credit_45, credit_60, cod, agent] | OK | Exact match, both files. |
| AP-terms template download + signed-terms upload | `vendors.signedTermsFileId` | OK | Validated attachment (ADR-0013). Templates are static assets. |

### E. Approval workflow

| Prototype element | Schema coverage | Verdict | Proposed change |
|---|---|---|---|
| Office registration → Submit for HOD approval → Approve & activate / Reject | `approvalTriggerEnum.office_vendor_registration`; `approvalRequests`/`Steps`; `vendorStatusEnum.pending_hod` | OK | Schema is **richer** — models office reg as its own trigger. Seed an `office_vendor_registration` route → HOD (see SEED-3). |
| Self registration → submit → Pending → AP approve → Active | `approvalTriggerEnum.new_vendor_registration` | OK | — |
| Bank change → Send for HOD approval (route "AP Staff → AP Manager") | `approvalTriggerEnum.bank_change` | OK | — |
| Non-bank data update | `approvalTriggerEnum.non_bank_change` | OK | — |
| Vendor reactivation | `approvalTriggerEnum.reactivation` | OK | — |
| Recall before decision; one pending change at a time | `approvalStatusEnum.recalled`; `approval_requests_one_pending_per_vendor_uq`; `vendors.changePending` | OK | ADR-0010 invariants present. |
| Named assignee / delegate / escalation override | `approvalRequestSteps.assigneeUserId/isOverride/reassignedFrom` | OK | — |
| **Vendor Blacklist route** (→ AP Manager) | no `blacklist` trigger; `blacklisted` status unreachable | SCOPE | Phase 3 (Violations pillar). Do **not** add a trigger; keep route out of the seed. |

### F. RBAC & roles

| Prototype element | Schema coverage | Verdict | Proposed change |
|---|---|---|---|
| RBAC matrix modules (11): Dashboard, Vendor Registration, Documents & Compliance, Invoice Submission, Invoice Processing, Approvals/Workflow, POs & Contracts, Master Data, Communications, Reports, Administration | `rbacModuleEnum` (9): vendors, documents, approvals, registration_lists, operational_lists, approval_routes, document_master, access, audit | **SCHEMA-WINS** | ADR-0012 nine-module grouping is settled. **Rebuild the console Access matrix to the 9 enum modules** — drop Invoice/PO/Comms/Reports rows (Phase 1), split "Master Data/Administration" into the 4 schema modules (registration_lists, operational_lists, approval_routes, document_master) + access + audit. |
| Permission verbs: Add / Edit / Delete / View / Approve | `rolePermissions.canAdd/canEdit/canDelete/canView/canApprove` | OK | 5-verb match. |
| Roles (console Roles list): AP/Tax-Finance Verifier, Document Verifier, Cost/Budget Owner, Approver, Treasury, System Administrator | `roles` (master, seeded) | SEED | These are **invoice-pipeline** roles. Domain-model Phase-0 actors are AP Staff, AP Supervisor/Asst. Manager, AP Manager, HOD, Document Verifier, System Administrator. Reconcile the **seed** to the domain-model set (see SEED-2); schema is fine. |
| RBAC seed keys: Vendor, AP User, AP Manager | `roles` + `userRoles` | SEED | Placeholder trio; expand to the full actor set in seed. |
| Copy-role | app behaviour over `rolePermissions` | OK | No schema need. |
| `roles.lead_user_id` (auto-dispatch) | `roles.leadUserId` | OK | Present per ADR-0012; prototype implies it via approval routes. |

### G. Master data lists (16)

| Prototype list | Schema table | Verdict | Note |
|---|---|---|---|
| Users, Departments, Vessels, Roles, Approval Routes, Documents, Tax Codes, SLA Thresholds, Banks, Business Entities, Audit Trail, Currencies, Countries, Marine Ports, Vendor Categories, Access (RBAC) | `users`, `departments`, `vessels`, `roles`, `approvalRoutes(+Steps)`, `documentMaster(+categoryDocumentRequirements)`, `taxCodes`, `slaThresholds`, `banks`, `businessEntities`, `auditLog`, `currencies`, `countries`, `ports`, `vendorCategories`, `rolePermissions` | OK | **Every list has a table.** Bilingual `name_id/name_en` present where the value is a term; proper names keep single `name` (ADR-0011). |
| Bank `location` (Local/Foreign) | `banks.location` + `localityEnum` | OK | — |
| Currency "Show in bank multi-currency selector" | `currencies.showInBankSelector` | OK | The 'multi' flag. |
| Tax Code (code, label, rate, basis, applies) | `taxCodes.*` + `docAppliesToEnum` | OK | — |
| SLA (stage, target, warn, email) | `slaThresholds.*` | OK | Behaviorally inert Phase-0 (ADR-0002). SLA stages listed are invoice-pipeline (Phase 1) — seed as inert config. |
| Port (name, code, country, tz, lat, lon) | `ports.*` | OK | — |
| Vessel (code, name, type) | `vessels.*` | OK | — |

### H. Out-of-Phase-0 modules — **NOT stubs (key finding)**

| Prototype module | Built as | Schema | Verdict | Action |
|---|---|---|---|---|
| Invoice Processing (console) / Submit Invoice + Tracking (portal) | **Real screens** — queue, 3-way match, tax checks (e-Faktur/PPN/PPh/e-Bupot/e-Materai) | none | SCOPE | Destination says ship as **"coming soon" shell**. Down-scope to a navigable placeholder. No Phase-0 schema. |
| POs & Contracts (both) | **Real screens** — awarded POs, contract expiry, RFQ/DO/PO flow | none | SCOPE | Shell only. (Prototype even notes "ERP sync arrives in Phase 2".) |
| Communications (console) / Announcements (portal) | **Real screens** — broadcasts, notification channels (incl. WhatsApp) | none (Phase-0 `notifications` is transactional only) | SCOPE | Shell only; helpdesk is "Phase 3" per prototype. |
| Reports (console) | **Real screens** — 3 XLSX export cards | none | SCOPE | Shell only ("coming soon"). |
| Violations / Blacklist (console vendor drawer) | **Real flow** — report modal, AP-Manager approval, blacklist lockout | `vendorStatusEnum.blacklisted` only, unreachable | SCOPE | **Phase 3.** Hide/disable the Violations tab and blacklist action; do not seed the blacklist route. |
| Dashboard (both) with live metrics | Real screens, seeded numbers | none | SCOPE | Dashboards with real metrics are Phase-1 (map Out-of-scope). Phase-0 = static/derived-lite or shell. |

---

## Recommended schema edits (prioritised)

> "The README says update the schema if drift is found — propose here, don't apply blindly." Apply these
> within M2/M3, gated on the M2 grilling. All are **additive** (new nullable columns / one new enum) —
> no destructive migration, no existing-table rewrite.

**P0 — decide before M3.1 (`vendors` schema):**
1. **`vendors.taxStatus`** — new pg enum `tax_status` (`pkp_corporate`, `pkp_individual`, `non_pkp_corporate`,
   `non_pkp_individual`), nullable in Draft, required at submit for local origin. Drives PPN eligibility +
   SPPKP requirement. *(Alternative: `isPkp boolean` + `taxpayerType` enum.)*
2. **`documentVersions.refNo varchar(120)` (nullable)** — holds the certificate/registration number the
   vendor types beside each upload (NPWP no. is also the dedup key on `vendors.taxId`; SIUP no., NIB no.,
   deed no. currently have nowhere to live).

**P1 — nice-to-have, low risk (fold into M3):**
3. **`documentVersions.variant varchar(60)` (nullable)** — deed type (Pendirian / Perubahan Nama /
   Amendment) and similar doc sub-variants.
4. **`vendors.companyScale varchar(24)` (nullable)** — Skala Perusahaan (per SIUP), *if* confirmed Phase-0;
   else drop the portal field.
5. **`vendorBanks.description varchar(200)` (nullable)** — the bank "Deskripsi/Description" field.

**P2 — confirm-then-drop (likely not schema):**
6. **NPWP sub-type** (Personal/Head-Office/Branch) and **Vendor Procurement** — confirm Phase-0 relevance
   in the M2 grilling; most likely fold into `taxStatus` / drop rather than add columns.

**No change (schema already wins — fix the prototype instead):** RBAC 9-module matrix, email-first login,
blacklist trigger absence, invoice/PO/comms/reports absence.

---

## Seed-consistency notes (feed [#10](https://github.com/sinardyas/vms/issues/10) — UAT seed design)

These are **data** reconciliations, not schema changes — but the seed loader must resolve them so dropdowns,
routes, and the gate behave:

- **SEED-1 — Vendor categories:** portal Klasifikasi shows 4 (Suku Cadang, Bahan Bakar, Provisi, Galangan);
  console master has 15. **Seed the full 15** (bilingual); the 4 are a prototype subset.
- **SEED-2 — Role set:** console shows two *different* role lists (invoice-pipeline roles vs `Vendor/AP User/
  AP Manager`). Neither matches the domain-model Phase-0 actors. **Seed the domain-model set**: AP Staff,
  AP Supervisor/Asst. Manager, AP Manager, HOD, Document Verifier, System Administrator, Vendor (+ `lead_user_id`).
- **SEED-3 — Approval routes:** seed one route **per `approvalTriggerEnum` value** — `new_vendor_registration`
  (AP Staff → AP Supervisor/Asst. Manager), **`office_vendor_registration` (→ HOD)** (prototype folds this into
  the HOD modal but the trigger is a first-class enum value), `bank_change` (AP Staff → AP Manager),
  `non_bank_change`, `reactivation`. **Do NOT seed a blacklist route** (Phase 3).
- **SEED-4 — Currency codes:** portal bank chips use **`CNH`** (offshore RMB); console master uses **`CNY`**.
  Pick one — **`CNY`** matches the ISO-4217 master — and align the portal.
- **SEED-5 — Business-entity casing:** portal stores upper-case (`PT, CV, FIRMA…`), console title-case
  (`PT, CV, Firma…`). Seed **one canonical casing** (title-case, bilingual `name_id/name_en`).
- **SEED-6 — Document master:** seed `DOC-000…DOC-020` with `appliesTo`/`mandatory`/`validityDays`/`reminder`
  as sketched in the console seed, and wire `category_document_requirements` so the origin∪category gate is
  demonstrable. (`DOC-018` Bank Proof / `DOC-019` KTP are **attachments** — do not put them in the gated set.)
- **SEED-7 — Tax codes:** seed `PPN 11% (both)`, `PPh 23 2% (local)`, `PPh 4(2)`, `PPh 21`, `PPh 26 20%
  (foreign)`. Note the portal's PKP status (schema edit P0-1) and the tax-code master are complementary, not
  duplicative.

---

## "Which wins" rulings (summary)

| Conflict | Winner | Why |
|---|---|---|
| Tax/PKP status: portal captures it, schema omits | **Prototype** → add column | Real Phase-0 registration data (ADR-0002 scope); drives PPN/SPPKP. |
| Doc reference numbers (SIUP/NIB): portal captures, schema omits | **Prototype** → add `refNo` | Load-bearing legal identifiers shown in profile. |
| RBAC modules: 11 UI vs 9 schema | **Schema** | ADR-0012 grouping is a settled decision; UI is a mock. |
| Role set: prototype vs domain model | **Domain model** | ADR/domain actors drive approval routes + SoD; reconcile in seed. |
| Login: USER-ID vs email | **Schema/ADR** | ADR-0004 email-first is settled. |
| Invoicing/PO/Comms/Reports: real screens vs shells | **Destination** | Map destination = "coming soon" shells; down-scope the build. |
| Violations/Blacklist flow | **Scope (Phase 3)** | Out-of-scope in the map; keep `blacklisted` unreachable. |
| Currency `CNH` vs `CNY`, entity casing | **Master (console)** | ISO-canonical; align portal in seed. |

---

## Confidence & residual unknowns

- The schema/domain/ADR side was read in full (all 13 schema files, domain model, ADR-0004/0013 + build plan
  M2/M3). The prototype side was extracted field-by-field from both HTML bundles (portal registration wizard +
  console Phase-0 sections).
- **Open for the M2 grilling:** whether **Company Scale**, **Vendor Procurement**, and **NPWP sub-type** are
  Phase-0 (P1/P2 edits hinge on this). Recommend resolving in the M2 master-data grilling before M3.1 build.
- Nothing in this audit invalidates a committed table; all recommendations are additive.
