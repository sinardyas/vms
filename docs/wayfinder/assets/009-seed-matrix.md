# 009 — UAT Seed-Scenario Design (data matrix + accounts)

**Ticket:** [UAT seed-scenario design (data matrix + accounts) (#10)](https://github.com/sinardyas/vms/issues/10) · type `grilling` (HITL)
**Depends on:** [003 — Drift Audit (#4)](https://github.com/sinardyas/vms/issues/4) — the SEED-1…SEED-7 reconciliations are folded in below.
**Date:** 2026-07-15

> **What this is.** The *data matrix* every Phase-0 golden path is walked against — **not** the loader code.
> The runnable seeder is a separate fog ticket that graduates once the M2 (master data) and M3 (vendor
> registration) schema exist. This document is the seeder's specification: what rows exist, in what state,
> so that a fresh `docker compose up` lands testers in a believable, pre-populated Soechi VMS.
>
> **HITL decisions taken (grilling, 2026-07-15):** (1) **adopt the 8-vendor roster** below — fictional but
> realistic Indonesian tanker-shipping vendors spanning all six states × Local/Foreign; (2) **one shared
> password across all pre-seeded accounts + one fresh, unverified signup** to exercise the Mailpit
> email-verify path; (3) **full in-flight set — exactly one recognisable item per Phase-0 queue.**

---

## 0. Conventions

- **Bilingual:** every master-data *term* row carries `name_id` + `name_en` (ADR-0011); proper names
  (people, companies, ports, vessels) keep a single `name`.
- **Referential rule:** every vendor field references an **active** master row at capture. The seed
  activates every master row it references.
- **Files:** document uploads and bank proofs are seeded as small placeholder PDFs/JPGs in MinIO bucket
  `vms-documents`, each with a `files` row (mime, sizeBytes ≤ 2 MB). Filenames are recognisable
  (`bahari-npwp.pdf`, `marine-survey-coi.pdf`).
- **Dates:** seeded relative to a fixed anchor `SEED_DATE = 2026-07-01` (the loader stamps real dates at
  run time from this anchor — issue/expiry/verifiedAt/submittedAt below are expressed as offsets so the
  scenario ages predictably regardless of when `docker compose up` runs).
- **Password (all accounts):** `SoechiUAT#2026`. Documented on the UAT login card, never a real secret.

---

## 1. Accounts

### 1.1 Staff logins (Console) — `@vms.test`, all pre-verified

| Email | Role (domain-model actor) | Purpose in the golden paths |
|---|---|---|
| `apstaff@vms.test` | **AP Staff** | Raises office registrations; step-1 approver on `new_vendor_registration`. |
| `apsuper@vms.test` | **AP Supervisor / Asst. Manager** | Step-2 approver; owns the mid-route approval (vendor 3). |
| `apmanager@vms.test` | **AP Manager** | Approves `bank_change` / `reactivation`; approver on vendor 1's pending bank edit. |
| `hod@vms.test` | **HOD** | Activates office registrations (vendor 4, Pending-HOD queue). |
| `verifier@vms.test` | **Document Verifier** | Works the doc-verification queue (vendor 3 docs; issued vendor 5's rejection). |
| `sysadmin@vms.test` | **System Administrator** | Master-data + Access (RBAC) administration; can see everything. |

- Roles map to the **domain-model actor set** (SEED-2), seeded into `roles` + `userRoles`, each with the
  9-module × 5-verb `rolePermissions` grid appropriate to the actor (deny-by-default; `sysadmin` full).
  `roles.leadUserId` is set (ADR-0012 auto-dispatch): AP-Staff lead = `apstaff`, HOD lead = `hod`, etc.
- **Separation of duties:** the seeded permission grid must let the mid-route approval (vendor 3) require
  a *different* actor at each step (AP Staff submit → AP Supervisor decide) so SoD is demonstrable.

### 1.2 Vendor-owner logins (Portal) — `@vendor.test`, all pre-verified

One owner account per seeded vendor 1–8 (the vendor's first sub-user, ADR-0004). Recognisable local-parts:

| Login | Vendor |
|---|---|
| `owner+bahari@vendor.test` | 1 · PT Bahari Bunker Nusantara |
| `owner+samudra@vendor.test` | 2 · PT Samudra Sparepart Marindo |
| `owner+chandler@vendor.test` | 3 · PT Chandler Provisi Bahari |
| `owner+galangan@vendor.test` | 4 · PT Galangan Docking Jaya |
| `owner+krewing@vendor.test` | 5 · PT Krewing Maritim Sentosa |
| `owner+marinesurvey@vendor.test` | 6 · Marine Survey Global Pte Ltd |
| `owner+oceanspare@vendor.test` | 7 · Ocean Spare Parts Co., Ltd |
| `owner+pelabuhan@vendor.test` | 8 · PT Pelabuhan Agen Nusantara |

### 1.3 Fresh-signup demo — **NOT seeded / left un-verified**

- `newvendor@example.com` is **not** created by the seeder. It is the tester's from-scratch path:
  register on the Portal → the verification email lands in **Mailpit (`:8025`)** → click through → session →
  resumable Draft. This is the only account whose email-verify step is exercised live; every seeded
  account above skips it (`emailVerified = true`) so testers can log straight in.

---

## 2. Vendor roster (the scenario spine)

Eight vendors covering **all six** `vendorStatusEnum` states and **both** origins. Each row is a real
tanker-shipping supplier archetype (fictional names) so a Soechi AP tester recognises the workflow.

| # | Vendor | Category (SEED-1 set) | Origin | Source | **Status** | taxStatus (P0) | Golden path it unlocks |
|---|---|---|---|---|---|---|---|
| 1 | **PT Bahari Bunker Nusantara** | Bahan Bakar / Fuel | Local | self | **Active** | `pkp_corporate` | Self-reg happy path; **+ pending bank-change** (post-activation edit). |
| 2 | **PT Samudra Sparepart Marindo** | Suku Cadang / Spare Parts | Local | office | **Active** | `pkp_corporate` | Office-reg activated via HOD (the "already done" reference). |
| 3 | **PT Chandler Provisi Bahari** | Provisi / Provisions | Local | self | **Pending** | `non_pkp_corporate` | Mid-route approval **awaiting AP Supervisor**; docs **in verifier queue**. |
| 4 | **PT Galangan Docking Jaya** | Galangan / Shipyard | Local | office | **Pending-HOD** | `pkp_corporate` | Office-created, **HOD activation queue**. |
| 5 | **PT Krewing Maritim Sentosa** | Crewing / Manning | Local | self | **Draft** (rejected) | `non_pkp_individual` | A mandatory doc **Rejected → back to Draft** w/ reason; resubmit path. |
| 6 | **Marine Survey Global Pte Ltd** | Surveyor / Class | **Foreign** (SG) | self | **Active** | *n/a (foreign)* | Foreign happy path with the **foreign doc set** (COI/DGT/COR/AoA). |
| 7 | **Ocean Spare Parts Co., Ltd** | Suku Cadang / Spare Parts | **Foreign** (CN) | self | **Draft** | *n/a (foreign)* | **Resumable half-filled** self-reg; **CNY** bank (SEED-4). |
| 8 | **PT Pelabuhan Agen Nusantara** | Port Agent | Local | office | **Inactive** | `pkp_corporate` | Dormant / concluded; **reactivation-eligible** (route → AP Manager). |

**Distribution check:** Draft ×2 (5 rejected-into-Draft, 7 fresh) · Pending ×1 · Pending-HOD ×1 · Active ×3
(1, 2, 6) · Inactive ×1 · Blacklisted ×0 (correctly unreachable in Phase-0). Origins: Local ×6, Foreign ×2.
Sources: self ×5, office ×3.

### 2.1 Per-vendor profile depth

Every vendor carries a **complete** profile so no screen shows a blank field: `name`, `businessEntityId`
(title-cased master, SEED-5), `categoryId`, `taxId` (NPWP, dedup key), address/city/postal/`countryId`,
phone/fax, `yearFounded`, `website`, `email`, `commissioner`, `director`, PIC `{name, role, phone(WA),
email}`, `soechiReference`. Foreign vendors (6, 7) leave `taxStatus` null and use the foreign doc set.

- **P0 schema fields (from drift audit) are populated:** `vendors.taxStatus` per the table above;
  `documentVersions.refNo` holds each cert's number (NPWP no., SIUP no., NIB no., deed no.);
  P1 `documentVersions.variant` = deed type (Pendirian / Perubahan Nama); `vendorBanks.description` set
  where natural. If these columns are not yet migrated when the loader is built, the loader degrades
  gracefully (skips them) — but the M3 build should land them (drift-audit P0/P1).

### 2.2 Banks (per `vendorBanks` invariants)

- Every non-Draft vendor has **exactly one `isPrimary` (Bank Utama)**. Local vendors bank in **IDR** at
  Indonesian banks (BCA, Mandiri, BNI from the `banks` master); foreign vendors bank abroad —
  **vendor 6** in **SGD** (DBS, Singapore), **vendor 7** in **CNY** (Bank of China) — exercising
  `vendorBankCurrencies` M:N and the `bankCountryId ≠ vendor.countryId` **remark** requirement.
- **Vendor 1** additionally has a **second bank pending** via the post-activation bank-change (§4).
- At least one vendor (e.g. **vendor 3**) has **`holderSameAsCompany = false`** → seeded **KTP +
  Surat Pernyataan** files, so that invariant is visible.

### 2.3 Documents & the activation gate

- **Local doc set** (mandatory subset that gates activation): Pakta Integritas, NPWP, SPPKP (PKP vendors
  only), SIUP/NIB, Akta. **Foreign doc set:** COI, Form DGT, COR, AoA, Business License.
- **Active vendors (1, 2, 6):** every mandatory doc for their origin∪category is **`Verified`** with real
  `issuedOn`/`expiresOn` and `verifiedBy = verifier@vms.test` — so the gate is *satisfied* and activation
  is explained by data, not magic.
- **Vendor 3 (Pending):** docs uploaded, **`verifyStatus = Pending`** → they populate the **Document
  Verifier queue**.
- **Vendor 5 (rejected→Draft):** one mandatory doc **`Rejected`** with a `rejectReason`
  (e.g. *"SIUP expired — upload the renewed certificate"*), which is why the vendor is back in Draft.
- **Vendor 7 (Draft):** partial uploads only (demonstrates a resumable, incomplete draft).
- `DOC-018` (Bank Proof) and `DOC-019` (KTP) are **attachments, not gated** (SEED-6).

---

## 3. Master data (all 16 lists — bilingual, seeded active)

Driven by the drift audit; the seeder loads every list so dropdowns, routes and the gate work.

| # | List | Seed content (headline) | Reconciliation |
|---|---|---|---|
| 1 | **business_entities** | PT, CV, Firma, Perorangan, Koperasi, Yayasan… — **title-case**, bilingual | **SEED-5** (one canonical casing) |
| 2 | **vendor_categories** | **All 15** (Suku Cadang, Bahan Bakar, Provisi, Galangan, Crewing, Surveyor, Port Agent, …) bilingual | **SEED-1** (not the prototype's 4) |
| 3 | **banks** | BCA, Mandiri, BNI, BRI (Local) + DBS-SG, Bank of China (Foreign), each `location` via `localityEnum` | — |
| 4 | **currencies** | IDR, USD, SGD, **CNY**, EUR, JPY — `showInBankSelector` set; **no `CNH`** | **SEED-4** (CNY, drop CNH) |
| 5 | **countries** | Indonesia, Singapore, China, + common trade partners | — |
| 6 | **document_master** | **DOC-000 … DOC-020** with `appliesTo`/`mandatory`/`validityDays`/`reminder`; wired to `category_document_requirements` so the **origin∪category gate is demonstrable** | **SEED-6** |
| 7 | **approval_routes (+ steps)** | **One route per `approvalTriggerEnum`**: `new_vendor_registration` (AP Staff → AP Supervisor), **`office_vendor_registration` → HOD**, `bank_change` (AP Staff → AP Manager), `non_bank_change`, `reactivation` (→ AP Manager). **No blacklist route.** | **SEED-3** |
| 8 | **users** | The §1 accounts | SEED-2 |
| 9 | **roles** | Domain-model actor set (AP Staff, AP Supervisor/Asst. Manager, AP Manager, HOD, Document Verifier, System Administrator, Vendor) + `leadUserId` | **SEED-2** |
| 10 | **rbac (role_permissions)** | 9-module (`rbacModuleEnum`) × 5-verb grid per role — **not** the prototype's 11 modules | drift §F (schema wins) |
| 11 | **tax_codes** | PPN 11% (both), PPh 23 2% (local), PPh 4(2), PPh 21, PPh 26 20% (foreign) | **SEED-7** |
| 12 | **soechi_entities** | Group companies (buyer entities, ADR-0006) — canonical casing | drift §G |
| 13 | **departments** | AP/Finance, Procurement, HOD-owning dept(s) | — |
| 14 | **vessels** | A handful of Soechi tankers (code, name, type) | — |
| 15 | **ports** | Key Indonesian ports (Tanjung Priok, Tanjung Perak, Balikpapan…) + Singapore | — |
| 16 | **sla_thresholds** | Seeded as **inert config** (behaviourally inert in Phase-0, ADR-0002) | drift §G |

---

## 4. In-flight artefacts (staged mid-workflow — full set, one per queue)

So every Phase-0 queue is **non-empty on first login** and each shows exactly one *recognisable* item:

| Queue / surface | Seeded item | Worked by |
|---|---|---|
| **Approvals queue** | Vendor 3 `new_vendor_registration` ApprovalRequest, `status = Pending`, `currentStep` = AP Supervisor step (AP Staff step already passed) | `apsuper@vms.test` |
| **HOD activation queue** | Vendor 4 `office_vendor_registration` request, Pending-HOD | `hod@vms.test` |
| **Document-verification queue** | Vendor 3's uploaded docs, `verifyStatus = Pending` | `verifier@vms.test` |
| **Rejection / resubmit** | Vendor 5 — one mandatory doc `Rejected` (+ reason), vendor back in **Draft** | owner resubmits; `verifier` issued it |
| **Post-activation edit** | Vendor 1 (Active) `bank_change` ApprovalRequest `Pending` → **AP Manager**; `vendors.changePending = true`; the vendor **stays Active** (ADR-0010, one pending change at a time) | `apmanager@vms.test` |
| **Reactivation** | Vendor 8 Inactive — eligible to submit a `reactivation` request (route → AP Manager) | owner initiates; `apmanager` decides |

**Invariants the seed must honour:** at most **one pending change per vendor** (`approval_requests_one_
pending_per_vendor_uq`); each in-flight approval's `currentStep` role must match a seeded route step; the
mid-route approval (vendor 3) must be **actionable by AP Supervisor** (route role ∧ approve permission) and
**not** by the submitter (SoD).

---

## 5. Golden paths this seed makes immediately walkable

From a fresh `docker compose up`, a tester can walk **every** Phase-0 path without first creating data:

1. **Self-registration (happy):** log in as `newvendor@example.com` (register fresh) → Mailpit verify →
   resume Draft → submit → (as `apstaff`/`apsuper`) approve → (as `verifier`) verify docs → Active.
   *(Reference end-state: vendor 1.)*
2. **Resume a Draft:** log in as vendor 7's owner → continue the half-filled foreign registration.
3. **Office registration → HOD:** as `apstaff` register an office vendor → Pending-HOD → as `hod` activate.
   *(Live queue item: vendor 4.)*
4. **Mid-route approval:** as `apsuper`, decide vendor 3's pending request (SoD-guarded).
5. **Document verification + gate:** as `verifier`, work vendor 3's queue; watch the activation gate.
6. **Doc rejection → resubmit:** as `verifier` see vendor 5's rejected doc; as the owner, resubmit.
7. **Post-activation bank change:** as vendor 1's owner submit a bank change → as `apmanager` approve;
   vendor stays Active throughout.
8. **Reactivation:** vendor 8 (Inactive) → reactivation request → `apmanager` approves → Active.
9. **Foreign vs Local:** compare vendor 6 (foreign doc set, SGD bank) against the local vendors.
10. **Master-data & Access admin:** as `sysadmin`, browse all 16 lists and the 9-module RBAC matrix.

---

## 6. Out of scope for the seed (do not seed)

- **No blacklist route / no `blacklisted` vendor** — Phase 3 (drift §E/§H, map Out-of-scope).
- **No invoicing / PO / communications / reports data** — those ship as "coming soon" shells (#9); the
  seed populates nothing behind them.
- **No live SLA behaviour / dashboards with real metrics** — SLA rows are inert config only.

---

## 7. Handoff to the loader (fog ticket)

This matrix is the input to **"Seed-scenario loader implementation"** (currently in the map's *Not yet
specified*). It graduates to a ticket once the **M2 (master data)** and **M3 (vendor registration)** schema
exist — the loader needs those tables and the P0 columns (`taxStatus`, `documentVersions.refNo`) present.
The loader should be **idempotent** (re-runnable on `docker compose up`) and seed MinIO placeholder files
alongside the DB rows. No loader code is written here — by design, this ticket decides the *data*, not the code.
