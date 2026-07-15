# ADR-0012: RBAC module set, E-Proc export, notifications, initial assignment

- **Status:** Accepted
- **Date:** 2026-07-13
- **Deciders:** (project owner), Claude

## Decisions

### RBAC modules — grouped
Permission subjects (each with `add/edit/delete/view/approve` as applicable):

| Module | Covers |
|---|---|
| **Vendors** | vendor records, registration, edits |
| **Documents** | upload + verification (verify ≈ approve permission) |
| **Approvals** | acting on ApprovalRequests / workflow steps |
| **Registration-lists** | business_entities, vendor_categories, banks, currencies, countries |
| **Operational-lists** | departments, vessels, ports, tax_codes, sla_thresholds, soechi_entities |
| **Approval Routes** | the routing config |
| **Document Master** | the document catalogue |
| **Access** | users, roles, RBAC matrix |
| **Audit** | view the audit trail |

(Coarser than per-list, finer than one bucket — Access is deliberately its own module so list-editors
aren't user-admins.)

### E-Proc export — deferred
No export in Phase 0. The "Push to E-Proc" affordance is hidden/disabled. The boundary (approved vendor →
E-Proc) is a later phase; nothing half-wired.

### Notifications (Phase 0 events)
Email verification; **approval decision → vendor** (approve/activate & reject-with-reasons + resume link);
**document rejected → vendor**; **step assigned → approver** (+ office **invite email on HOD activation**).
Channel default: vendors → **email**; internal users → **in-app + email**. Content localized (ADR-0008).

### Initial assignment — auto to role lead, then delegate
Each **Role** designates a **lead user**. When a step opens, it auto-assigns to that role's lead, who keeps
or **delegates/reassigns** to an eligible decider. SoD still governs *deciding*: if the lead is
disqualified (submitter/verifier), they may still dispatch but must delegate the decision to an eligible user.
Resolves the ADR-0010 open.

## Consequences

- `roles` gains a `lead_user_id`. Assignment logic: open step → assign lead → (optional) delegate.
- RBAC seed maps each role to permissions across the 9 modules (must satisfy ADR-0011 deadlock guard).
- Notification service with localized templates + an in-app notification store for internal users.
- No E-Proc code, tables, or config in Phase 0.
