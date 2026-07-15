# Phase 0 Build Plan — Soechi VMS (Registration + Master Data)

Derived from ADR-0002…0015 and `phase-0-domain-model.md`. This is the execution sequence:
**scaffold → identity/access → master data → registration → workflow → verification → notify/closeout.**

Sizes are relative effort **S / M / L** (not time). Each ticket lists dependencies and the ADRs it honours.

## Locked implementation defaults
better-auth · SMTP/Resend email · Postgres enums for closed sets · UUIDv7 IDs · MinIO files · bilingual
per-locale labels · server-enforced RBAC · action-log audit · E-Proc deferred. Full list: **ADR-0015**.

## Definition of Done (applies to every ticket)
- Migration + seed committed (where schema changes); typecheck + lint clean.
- Server-side **RBAC** enforced on every mutation (ADR-0011); **audit** event emitted (ADR-0011).
- All user-facing strings are **i18n keys** with ID + EN (ADR-0008); no hard-coded copy.
- Shared **Zod** schema in `packages/domain` is the single source of validation (API + forms).
- Unit tests for domain rules/invariants; golden-path e2e updated where relevant.

## Milestone map

| # | Milestone | Goal | Depends on | Key ADRs |
|---|---|---|---|---|
| **M0** | Foundation | Monorepo, infra, cross-cutting primitives, a walking skeleton | — | 0003, 0008 |
| **M1** | Identity & Access | Auth (both audiences), server-enforced RBAC, audit, Access admin | M0 | 0004, 0011, 0012 |
| **M2** | Master Data | All 16 lists, bilingual, deactivation semantics, seeds | M0 (RBAC gating: M1) | 0006, 0011, 0013 |
| **M3** | Registration (capture) | Self + office registration to *submit*; resumable Draft; docs to MinIO | M1, M2 | 0004, 0010, 0013 |
| **M4** | Approval Workflow | Generalized engine: routes, assignment, SoD, recall, edits, escalation | M1, M2, M3 | 0005, 0009, 0010, 0012, 0014 |
| **M5** | Verification & Gate | Verifier queue, activation gate, versioning, reject→Draft | M3, M4 | 0007, 0011, 0013, 0014 |
| **M6** | Notify & closeout | Notification events, in-app centre, reactivation, hardening/e2e | M4, M5 | 0009, 0012 |

**Critical path:** M0 → M1 → M2 → M3 → M4 → M5 → M6. See *Parallelization* for overlaps.

---

## M0 — Foundation
- **M0.1 Monorepo scaffold** *(M)* — Turborepo + Bun + TS; `apps/{api,portal,console}`, `packages/{db,domain,ui}`; lint/format, tsconfig, CI. *(ADR-0003)*
- **M0.2 Local infra** *(M)* — docker-compose Postgres + MinIO + Mailpit; env config; drizzle-kit migrate/seed; healthcheck.
- **M0.3 Domain foundation** *(M)* — `packages/domain`: result/error conventions, shared types, i18n message catalogue (ID+EN) + locale resolution. *(ADR-0008)*
- **M0.4 Cross-cutting primitives** *(M)* — request context (actor, locale, ip/ua); **audit** append-only writer; **RBAC** permission-check middleware skeleton. *(ADR-0011, 0012)*
- **M0.5 UI base** *(M)* — `packages/ui` tokens/components per `DESIGN_GUIDELINES.md`; portal & console app shells; i18n provider + locale switch.
- **M0.6 Walking skeleton** *(S)* — one authenticated end-to-end route that checks a permission, writes an audit row, reads DB, renders in console. De-risks the whole stack before feature work.

**Exit:** `bun run dev` starts all apps; migrate+seed works; skeleton path green in CI.

## M1 — Identity & Access
- **M1.1 Auth** *(L)* — better-auth: signup, **email verification**, login, session, password reset; `users.kind ∈ {vendor,internal}`. *(ADR-0004, 0015)*
- **M1.2 Access schema + seed** *(M)* — `users`, `roles(+lead_user_id)`, `permissions`, `role_permissions` (9 modules × add/edit/delete/view/approve), `user_roles`; seed roles **with matching permissions**. *(ADR-0011, 0012)*
- **M1.3 RBAC enforcement** *(M)* — guard every API mutation; domain `can(actor, module, verb)`; 403s; UI capability flags mirror server. *(ADR-0011)*
- **M1.4 Audit trail + viewer** *(M)* — emit action-log on all mutations; console **Audit** module (search/filter). *(ADR-0011)*
- **M1.5 Console — Access admin** *(L)* — Users CRUD (+reset pw, activate), Roles CRUD (+lead), **RBAC matrix editor with deadlock-guard warning** (0 eligible → warn). *(ADR-0011, 0012)*
- **M1.6 Eligibility/SoD primitive** *(S)* — domain fn: eligible approvers = `role ∩ approve-perm − SoD`; reused by M4. *(ADR-0009)*

**Exit:** internal users log in; permissions enforced server-side; every mutation audited; RBAC editable with guard.

## M2 — Master Data
- **M2.1 Master framework** *(M)* — generic active/deactivate (no hard delete), **per-locale labels** (`name_id`/`name_en`, fallback), referential-integrity rule (deactivate hides from *new* captures only). *(ADR-0006, 0011)*
- **M2.2 Registration lists** *(L)* — `business_entities`, `vendor_categories`, `banks`, `currencies`, `countries`: schema + CRUD + console screens + seeds. *(ADR-0013)*
- **M2.3 Document Master + requirements** *(L)* — `document_master` (applies_to origin, mandatory) + **`category_document_requirements`** (M:N, mandatory); console screen incl. category matrix; seed DOC-000…020. *(ADR-0013)*
- **M2.4 Approval Routes** *(M)* — schema + CRUD + console; seed the **2-step routes** (ADR-0009); deadlock-guard on save. *(ADR-0009, 0011)*
- **M2.5 Operational lists** *(L)* — `departments`, `vessels`, `ports`, `tax_codes`, `sla_thresholds`, `soechi_entities`: schema + CRUD + screens + seeds. **CRUD-only, behaviorally inert** (ADR-0002). *(ADR-0002, 0006)*

**Exit:** every list manageable per its RBAC module, bilingual, deactivation respected, seeds loaded → registration has its dropdowns.

## M3 — Vendor Registration (capture)
- **M3.1 Vendor schema** *(M)* — `vendors` (origin, status, source, category_id, `tax_id` with **partial unique WHERE status<>'Draft'**, profile, people, payment terms). *(ADR-0004, 0010)*
- **M3.2 Banks + attachments** *(M)* — `vendor_bank` (exactly-one primary, currencies M:N, holderSameAsCompany, **KTP+surat when holder≠company**, bank-country remark); attachments to MinIO (validated, not gated). *(ADR-0013)*
- **M3.3 Document capture** *(M)* — `document_slots` + `document_versions`; MinIO upload (mime/size), signed URLs; issue/expiry fields (entered at verify). *(ADR-0011, 0013)*
- **M3.4 Shared validation** *(M)* — Zod required-field sets per **origin**, submit-completeness, invariants; reused by portal + API. *(ADR-0004)*
- **M3.5 Portal — self-registration** *(L)* — account-first entry → **resumable** multi-section Draft (local/foreign, bilingual) → banks → doc upload → review → submit → Pending. Ref `vendor_portal.html`.
- **M3.6 Console — office registration** *(M)* — staff create → **Pending-HOD**; same validation. Ref `staff_console.html`.
- **M3.7 Vendor views** *(M)* — portal status view (read-only); console vendor profile tabs (details/docs/bank/activity).

**Exit:** vendor self-registers, leaves & resumes a Draft, submits; office staff register on-behalf; Tax-ID dupes blocked at submit with a friendly, linking error.

## M4 — Approval Workflow
- **M4.1 ApprovalRequest schema** *(M)* — `approval_requests` (subject, trigger, payload/diff, route, status) + `approval_request_steps` (role, `assignee_user_id`, decision, reason, at, `is_override`). *(ADR-0005, 0010, 0014)*
- **M4.2 Routing engine** *(L)* — resolve route by trigger; sequential steps; **auto-assign to role lead** + delegate/reassign; approve advances / final approve applies effect; reject → Draft. *(ADR-0005, 0012)*
- **M4.3 SoD + escalation** *(M)* — eligibility (M1.6), no self-approval, verifier≠approver; zero-eligible → **admin override** (`is_override`, audited). *(ADR-0009, 0014)*
- **M4.4 Transitions + freeze/recall** *(M)* — Draft→Pending→Active; **freeze Pending**; **submitter recall** (pre-decision); one-pending-change lock for edits. *(ADR-0010, 0014)*
- **M4.5 Post-activation edits** *(M)* — bank-change (→AP Manager) & non-bank (→AP Supervisor) as diffs applied on approval; change-pending flag. *(ADR-0005, 0009)*
- **M4.6 Console — approvals UX** *(L)* — my-queue / role-queue; request detail showing **route progress + verification progress**; approve/reject/delegate/reassign/override. *(ADR-0012, 0014)*

**Exit:** a submitted registration flows its route to Active (subject to M5 gate); recall/reject work; Active-vendor edits re-approve with locking; no-approver escalates.

## M5 — Document Verification & Activation Gate
- **M5.1 Verifier queue + actions** *(M)* — Documents module: per-doc verify/reject, **enter/confirm issue+expiry**, reject reason. Acts on **Pending** vendors' compliance docs only. *(ADR-0007, 0014)*
- **M5.2 Activation gate** *(M)* — required set = **origin ∪ single-category** (requirements matrix); block final-approval effect until all mandatory **Verified**; expose "N/M verified" + blockers. *(ADR-0013, 0014)*
- **M5.3 Reject → Draft + versioning** *(M)* — rejected **mandatory** doc returns request to Draft (reason + notify); re-upload creates a new **version**; verified state per version. *(ADR-0011, 0014)*
- **M5.4 Console — verification UX** *(M)* — queue, doc viewer (MinIO signed URL), verify/reject, gate status on the vendor.

**Exit:** activation is impossible until mandatory docs verified; rejecting a mandatory doc returns to Draft; re-upload versions correctly.

## M6 — Notifications & closeout
- **M6.1 Notification service** *(M)* — email (SMTP/Resend) + in-app store; localized templates; event dispatch. *(ADR-0012)*
- **M6.2 Wire events** *(M)* — email-verify (M1), **decision→vendor** (approve/reject + reasons + resume link), **doc-rejected→vendor**, **step-assigned→approver**, **office invite on activation**. *(ADR-0012)*
- **M6.3 In-app centre** *(M)* — console notification bell; portal status/notifications.
- **M6.4 Reactivation + deactivate** *(S)* — Inactive→Active via AP-Manager route; deactivate-vendor action. *(ADR-0009)*
- **M6.5 Hardening + e2e** *(L)* — golden-path e2e: self-reg→Active; office-reg→Active; edit→re-approve; doc-reject→resubmit; no-approver→escalate. i18n key audit; RBAC coverage; seed refresh.

**Exit:** all notification events fire localized; golden paths green; Phase 0 acceptance met.

---

## Suggested delivery increments (de-risk the "Phase 0 is big" problem)
- **Release A — Internal backbone:** M0 + M1 + M2. A working, RBAC'd, audited **admin console over all master data**. Shippable internally; no public portal yet.
- **Release B — Onboarding:** M3 + M4 + M5. Self/office registration → workflow → verified activation.
- **Release C — Polish:** M6. Notifications, in-app centre, reactivation, e2e hardening.

## Parallelization
- After **M0**: **M1** and **M2** overlap — M2 schema/seeds don't wait on RBAC; only the admin *screens* gate on M1.3.
- `packages/ui` + app shells build alongside API once domain contracts (Zod) exist.
- Notification **templates** (M6) can be drafted during M4/M5.
- The engine (M4) is the tallest pole — build the **registration trigger first**, generalize to **edits (M4.5)** after.

## Risks & mitigations (carried from grilling)
1. **Scope ("Phase 0" ≠ small).** → Walking skeleton (M0.6); Release A ships value before the portal; strict per-ticket DoD.
2. **"Role AND permission" deadlocks (ADR-0011).** → Seed roles with perms (M1.2); deadlock-guard (M1.5/M2.4); eligibility + escalation (M4.3).
3. **Bilingual data-entry cost (ADR-0008).** → Per-locale required in the master framework (M2.1); name a content owner; fallback rendering.
4. **Two audiences, one auth.** → Single `users.kind`; portal vs console authorization via RBAC, not separate stacks (ADR-0015).

## Phase 0 acceptance checklist
- [ ] Vendor self-registers (account + email verify), resumes a Draft, submits.
- [ ] Staff register a vendor on-behalf (→ Pending-HOD).
- [ ] All 16 master lists: CRUD, bilingual, RBAC-gated, audited, deactivation respected.
- [ ] Config-driven routes drive registration **and** post-activation edits; SoD + escalation enforced.
- [ ] Verification gates activation on origin ∪ category mandatory docs; versioned; mandatory-reject → Draft.
- [ ] Notifications (verify, decision, doc-reject, assignment, invite) fire, localized.
- [ ] RBAC enforced server-side everywhere; audit action-log complete.

## Out of scope (Phase 1+)
Invoicing (submission/tracking/workflow), PO & contracts, document-expiry monitoring engine, dashboards with
real metrics, communications/broadcasts, reports, live E-Proc/ERP integration, multi sub-user, blacklist/violations.
