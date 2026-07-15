# ADR-0014: Workflow sequencing — verification, freezing, escalation

- **Status:** Accepted
- **Date:** 2026-07-13
- **Deciders:** (project owner), Claude

## Decisions

### Document verification is a parallel prerequisite, not a route step
- The route stays `AP Staff → AP Supervisor` (self) / `→ HOD` (office). **Document Verifiers** verify
  compliance docs on a **separate** queue. The **final approval step's effect** (activate) is gated on all
  mandatory docs (origin ∪ category, ADR-0013) being `Verified`. Verification and route progression run
  independently; the gate is checked at activation.

### Verification happens after submit, on a frozen snapshot
- **Draft = capture** (upload only, no verification). **Submit → Pending = review.** Verifiers act on the
  submitted, **immutable** scans. A vendor's verified state is meaningful only for a submitted request.

### Pending is frozen — change via recall/reject
- While `Pending`, profile and documents are **immutable**. To change anything the submitter **recalls**
  (pre-decision, ADR-0010) or an approver **rejects** — either returns the vendor to `Draft` with reasons.

### A rejected mandatory document returns the request to Draft
- If a Document Verifier **rejects** a mandatory document, the registration request is **returned to Draft**
  with the rejection reason (and the vendor is notified, ADR-0012). This avoids the deadlock of a frozen
  Pending record that can never satisfy its gate. The vendor replaces the doc (new version, ADR-0011) and
  resubmits. (Rejection of a non-mandatory doc: flagged, does not force Draft.)

### Zero eligible approvers → escalate to admin/manager override
- If SoD + permissions leave a step with **no eligible approver**, the request **auto-escalates** to a
  System Administrator / higher manager who may approve as an **override**. The override is fully audited
  (actor, reason, that it bypassed the normal role). Prevents silent stalls; concentrates the exception in
  an accountable, logged action.

## Consequences

- Verifier queue is populated by **Pending** vendors' compliance docs only.
- The engine exposes, per Pending request: route progress **and** verification progress ("3/5 mandatory
  verified") so an approver sees why the gate is/ isn't satisfied.
- Doc-rejection is a state-affecting event (→ Draft) — recorded in the audit action log.
- Override path needs an `is_override` marker on the step decision.

## Updated registration flow

```
Draft (capture + upload) ──submit──▶ Pending (frozen)
   ▲                                   │  ├─ Doc Verifiers verify compliance docs (parallel)
   │  recall (pre-decision)            │  │      └─ reject mandatory ─▶ back to Draft (reason)
   │  reject (reasons)                 │  └─ route: AP Staff → AP Supervisor  (office: → HOD)
   └───────────────────────────────────┘         └─ final approve: gate(all mandatory Verified) ─▶ Active
                                                      no eligible approver ─▶ escalate → admin override
```
