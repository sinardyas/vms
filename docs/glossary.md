# Glossary — Soechi VMS (Ubiquitous Language)

Living document. Terms are drawn from the existing designs (`vendor_portal.html`, `staff_console.html`)
and the feature brainstorm, then sharpened during grilling. When code, UI and conversation disagree,
this file is the tie-breaker — update it, don't route around it.

> Status key: **✔ agreed** · **~ provisional** (in the design, not yet confirmed for Phase 0) · **? open**

## Actors

| Term | Meaning | Status |
|---|---|---|
| **Vendor** | An external company that supplies goods/services to Soechi. The subject of registration. | ✔ |
| **Vendor sub-user** | A person account belonging to a Vendor; multiple per Vendor. | ~ |
| **AP Staff** | Accounts-Payable staff who intake/verify vendor registrations (step 1 approver). | ~ |
| **AP Supervisor / Asst. Manager** | Step-2 approver for standard registration changes. | ~ |
| **AP Manager** | Higher-authority approver (bank-data changes, reactivation, blacklist). | ~ |
| **HOD** | Head of Department; approves office-created vendors before activation. | ~ |
| **Document Verifier** | Internal reviewer who approves/rejects an uploaded document. | ~ |
| **System Administrator** | Manages master data and RBAC in the Staff Console. | ~ |

## Onboarding & identity

| Term | Meaning | Status |
|---|---|---|
| **Self-registration** | Vendor creates its own record via the Vendor Portal. | ~ |
| **Office-registration** | Internal staff create the vendor record on the vendor's behalf via the Staff Console. Requires HOD approval. | ~ |
| **Hybrid onboarding** | Lightweight capture (profile + docs) lives in this portal; formal qualification/tender vetting stays in E-Proc. | ~ |
| **Origin** | Whether a vendor is **Local** (Indonesian) or **Foreign/Overseas**. Drives which fields & documents are required. | ✔ |
| **Business Entity** | The vendor's legal form (PT, CV, LLC, Pte. Ltd., …). A master-data list, split Local/Foreign. | ✔ |
| **Vendor Category** | Classification of what the vendor supplies (bunker, spare-parts, chandler, …). Master-data list. | ✔ |
| **PIC** | *Penanggung Jawab* — the vendor's person-in-charge (name, role, WhatsApp phone, email). | ✔ |
| **Bank Utama** | The vendor's primary bank account. Additional accounts allowed. | ✔ |

## Vendor lifecycle states (from the Staff Console)

| State | Meaning | Status |
|---|---|---|
| **Draft** | Record started, information incomplete, awaiting email activation. Cannot transact. | ~ |
| **Pending** | Profile complete, awaiting internal (AP) approval. | ~ |
| **Pending HOD** | Office-created vendor, complete, awaiting HOD approval. | ~ |
| **Active** | Fully verified & approved; full access. | ~ |
| **Inactive** | Relationship concluded / dormant. No new transactions. | ~ |
| **Blacklisted** | Permanent exclusion (ethics/legal/fraud). Hard lockout. | ~ |

## Master data (Staff Console admin lists)

| Term | Meaning | In Phase 0? | Status |
|---|---|---|---|
| **Document Master** | Catalogue of document types vendors may be asked to upload (DOC-000…), each with applies-to (local/foreign/both), validity days, mandatory flag, reminder cadence. | ? | ~ |
| **Banks** | Bank list feeding the portal bank dropdown; split Local/Foreign; deactivatable. | ? | ~ |
| **Business Entities** | Legal-form list feeding the registration entity dropdown. | ? | ~ |
| **Vendor Categories** | Category list feeding registration. | ? | ~ |
| **Currencies** | Currency list feeding bank multi-currency selectors. | ? | ~ |
| **Countries** | Country list feeding company/bank/port dropdowns. | ? | ~ |
| **Approval Routes** | Sequential approver roles applied to a vendor action (registration, bank change, reactivation, blacklist). | ? | ~ |
| **Users / Roles / RBAC** | Internal accounts, roles, and per-module add/edit/delete/view/approve permissions. | ? | ~ |
| **Marine Ports** | Port master (name, code, country, tz, lat/lon). | ? (likely later) | ~ |
| **Vessels** | Soechi fleet master. | ? (likely later) | ~ |
| **Departments** | Internal org units. | ? | ~ |
| **Tax Codes** | PPN / PPh master. | ? (invoicing → later) | ~ |
| **SLA Thresholds** | Per-stage SLA targets. | ? (invoicing → later) | ~ |

## Boundaries & integrations

| Term | Meaning | Status |
|---|---|---|
| **E-Proc** | The company's e-procurement system. Owns formal qualification/tender vetting; qualification status syncs back here. | ~ |
| **ERP** | Owns PO/GR/BAST/payment. Out of scope for Phase 0. | ~ |
| **Compliance gating** | Rule that expired mandatory documents block downstream actions (invoicing). Its applicability in Phase 0 is open. | ? |
| **Push to E-Proc** | The act of exporting a captured/approved vendor to E-Proc. Real vs manual in Phase 0 is open. | ? |
