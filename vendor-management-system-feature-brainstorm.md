# Vendor Management System (VMS) — Feature & Module Brainstorm

## Context

The company is a **tanker shipping operator in Indonesia** and needs a **Vendor Portal** that becomes the *centralized entry point* for vendors to interact with the company. The mandatory capabilities are: vendors submit invoices, track invoice processing, follow the invoicing workflow, and have their documents monitored for expiration. The portal will later integrate with the internal **ERP** and the company's **E-Proc** system.

This document is a **functional brainstorm only** — modules, features, and scope. No technology, architecture, or code decisions yet.

Reference point: **iVendor by Pertamina**, which works as a procure-to-pay + billing/tax tracking portal (vendor registration & bank data, BAST standardization, supplier-invoice integration, payment-approval visibility, and SLA tracking across the P2P cycle).

### Scope decisions confirmed with stakeholder
- **Onboarding = Hybrid**: lightweight self-registration + company profile + document capture live in *this portal*; formal qualification/tender vetting stays in *E-Proc*. Qualification status syncs back.
- **Sourcing = Leave to E-Proc**: this portal is **post-award** (contracts, POs, BAST, invoicing, documents, communication). No RFQ/quotation/e-auction here.
- **Phase 1 = Mandatory pillars first**: invoice submission, invoice tracking, invoicing workflow, document-expiration monitoring. Everything else is roadmap.
- **Invoicing = PO/contract-based AND non-PO**: support 3-way matching for PO invoices plus a separate path for ad-hoc/non-PO claims.

---

## Guiding Principles
- **Single front door** for vendors — one login for invoices, documents, POs, and communication.
- **Compliance-gated** — expired mandatory documents block invoice submission and (later) new awards.
- **Indonesian-tax-native** — Faktur Pajak/e-Faktur (PPN), PPh withholding, e-Bupot, NPWP/PKP, e-Materai, multi-currency (IDR + USD common in bunkering/shipping).
- **Transparency over phone/email** — vendors self-serve status instead of calling AP/Finance.
- **Integration-ready** — designed to consume from E-Proc/ERP later; Phase 1 can run on import/manual entry.

---

## Module Breakdown

### 1. Vendor Account & Profile (Hybrid onboarding)
- Self-registration: create account, company general info, contacts/PIC, bank details.
- Vendor profile: legal identity (NIB/OSS, NPWP, PKP status, akta + SK Kemenkumham, domicile), directors/ownership, bank accounts (with verification), supplied goods/service categories.
- Vendor categorization by tanker-shipping service type (see §A).
- Multiple sub-users per vendor with their own access.
- **Boundary**: profile + documents captured here → pushed to E-Proc for formal qualification → qualification/approval status synced back and displayed.

### 2. Document & Compliance Management *(Mandatory pillar)*
- Per-vendor **document repository** with versioning and audit trail.
- **Master list of required document types** per vendor category, each with a validity period.
- **Expiration monitoring**: traffic-light status (valid / expiring soon / expired) with configurable thresholds (e.g. 60/30/7 days).
- **Automated reminders** to vendor + internal owner before and after expiry.
- **Document verification workflow**: internal reviewer approves/rejects each uploaded document.
- **Compliance gating**: expired mandatory docs block invoice submission (and later, new awards).
- Shipping-specific document set (see §A).

### 3. Invoice Submission *(Mandatory pillar)*
- **PO/contract-based invoice**: vendor selects PO + linked receipt/BAST; supports **3-way matching** (PO ↔ receipt/BAST ↔ invoice) with tolerance checks and exception flagging.
- **Non-PO / ad-hoc invoice**: claims, reimbursements, one-off services — separate approval path with cost allocation.
- **Tax fields**: Faktur Pajak / e-Faktur number capture & validation, PPN, PPh withholding type (23, 4(2), 21), e-Bupot reference.
- **e-Materai** handling for invoices above the stamp-duty threshold.
- **Multi-currency** (IDR / USD) with exchange-rate handling.
- Supporting attachments: BAST, delivery note/GR, timesheet, contract reference.
- Validation: completeness checks, **duplicate-invoice detection**, amount-vs-PO variance.
- Credit notes, revisions, and rejection-and-resubmit flow.

### 4. Invoice Tracking & Status Visibility *(Mandatory pillar)*
- **Real-time status timeline**: submitted → document/tax verification → approval → payment scheduled → paid.
- **SLA tracking per stage** (iVendor-style P2P SLA) with breach indicators.
- Clear **rejection reasons & required actions**.
- Payment status + **payment advice / remittance** visibility.
- Invoice aging and dispute status.

### 5. Invoicing Workflow & Approvals *(Mandatory pillar)*
- Configurable multi-step routing across roles: vendor → document verifier → AP/tax-finance verifier → cost/budget owner (the dept that received the goods/service) → approver → treasury/payment.
- **BAST / service-acceptance** confirmation step (internal confirms delivery before payment).
- 3-way-match **exception handling** and **dispute/clarification loop** with the vendor.
- Escalation, delegation, and out-of-office reassignment.

### 6. PO & Contract Visibility (post-award)
- View awarded **POs / contracts** (synced from E-Proc/ERP; manual/import in Phase 1).
- **PO acknowledgement** by vendor.
- **Contract repository + contract-expiry monitoring** (shares engine with §2).
- Delivery/milestone tracking and **BAST submission**.

### 7. Communication & Collaboration Hub
- Company **announcements/broadcasts** to all or selected vendors.
- **Messaging/ticketing** tied to a specific invoice/PO/topic.
- **Helpdesk / support** for vendor queries.
- **Notification center**: in-app + email (consider WhatsApp, widely used in Indonesia).

### 8. Vendor Performance Management *(Later phase)*
- Performance scoring: delivery, quality, HSE, responsiveness.
- Warnings / sanction / blacklist status → feeds back to E-Proc qualification.

### 9. Dashboards & Reporting
- **Vendor dashboard**: my invoices, payment forecast, expiring documents, open POs, action items.
- **Internal dashboard**: invoice pipeline, SLA breaches, compliance/document status, payables aging.
- Exportable reports.

### 10. Administration & Security
- User & role management (internal + vendor sub-users).
- Master data: document types, vendor categories, workflow config, tax codes, SLA thresholds.
- Full **audit trail** and notification configuration.
- **Localization**: Bahasa Indonesia + English.

---

## §A. Tanker-Shipping Vendor Categories & Documents to Monitor

**Common vendor categories**: bunker/fuel suppliers, ship chandler/provisions, spare-parts suppliers, ship-repair/drydock yards, port agents, crewing/manning agencies, surveyors & classification societies, safety-equipment suppliers/servicing stations, lube-oil & marine-chemical suppliers, towage, insurance/P&I, logistics/freight forwarders.

**General Indonesian company documents (all vendors):**
- NIB (OSS), business license, NPWP, PKP / SPPKP
- Akta pendirian + SK Kemenkumham, domicile (SKDU)
- Bank account confirmation
- ISO 9001 / 14001 / 45001, **SMK3 (K3 / HSE)**
- **TKDN** (local-content) certificate — relevant in oil/gas/shipping procurement

**Maritime / tanker-specific (by category):**
- Bunker supplier: BBM trading/niaga license (ESDM/BPH Migas), bunker-barge certificates
- Crewing/manning: SIUPPAK (manning-agency license)
- Surveyors / class: classification-society accreditation (e.g. BKI)
- Safety equipment: type-approval & servicing-station approvals (liferaft, fire-fighting)
- Port agency: shipping-agency license
- Insurance / P&I: OJK license
- Lube oil / chemicals: MSDS, distributor authorization
- Ship repair / drydock: shipyard certifications, class approvals
- HSE pre-qualification given tanker/oil-cargo risk profile

*(The exact required-document matrix per category is an item to confirm with Procurement/HSE.)*

---

## §B. Integration Touchpoints (functional intent, not technical)
- **E-Proc**: vendor master & qualification status, awarded contracts/tenders, vendor categories, blacklist/sanction status.
- **ERP**: PO, goods receipt / service entry, BAST, invoice posting, payment status, cost centers, vendor finance master, exchange rates.
- **Tax (DJP)**: Faktur Pajak validation, e-Bupot — note **Coretax** is DJP's newer platform; confirm current state.
- **e-Materai** provider; **bank/payment** status (likely via ERP).

---

## Phased Roadmap
- **Phase 1 (MVP — mandatory pillars):** account + basic profile, document repository + expiration monitoring + alerts + compliance gating, invoice submission (PO + non-PO) with tax fields, invoice tracking, invoicing workflow/approvals, basic notifications, basic dashboards. PO/vendor data via import or manual entry until integrations land.
- **Phase 2:** real-time E-Proc & ERP integration (PO/GR/BAST/payment/vendor-master sync), contract management, e-Faktur/Coretax & e-Materai integration.
- **Phase 3:** vendor performance management, advanced analytics, helpdesk/ticketing, mobile app (à la Pertamina's M-Vendor), broader self-service.

---

## Open Questions (non-blocking, to refine before/with build)
1. Single legal entity or a group of entities (multi-company) invoicing?
2. Required-document matrix per vendor category — owned by Procurement or HSE?
3. Tax platform target — e-Faktur vs DJP Coretax — and whether validation is automated in Phase 1.
4. Notification channels — is WhatsApp wanted alongside email/in-app?
5. Phase 1 PO/vendor data source — manual entry, file import, or early read-only ERP feed?

---

## Next Steps
- Review this module list and roadmap with **Procurement, Finance/AP, Tax, HSE, and IT** stakeholders.
- Validate the §A document matrix against actual vendor-onboarding requirements.
- Confirm the Phase 1 boundary (mandatory pillars) and the E-Proc/ERP integration sequencing before any build planning.
