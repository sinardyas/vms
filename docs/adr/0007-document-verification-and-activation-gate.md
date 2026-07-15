# ADR-0007: Document verification & activation gate

- **Status:** Accepted
- **Date:** 2026-07-13
- **Deciders:** (project owner), Claude

## Context

Phase 0 chose **verify + gate activation**. Documents are captured at registration; the Staff Console's
"Verify all documents to approve" must be a real constraint.

## Decision

- Each uploaded document references a **Document Master** type and carries a verification status:
  `Pending` → `Verified` | `Rejected` (set by a **Document Verifier**), plus an optional `validUntil`
  derived from the type's validity (days).
- **Activation gate (hard invariant):** a Vendor cannot become `Active` until **every mandatory document
  for its origin** (per Document Master `applies_to` ∈ {local|foreign|both} and `mandatory = true`) is
  `Verified`. The approval engine (ADR-0005) checks this before applying the activation effect.
- A **Rejected** document blocks activation and requires re-upload (the registration request stays open /
  returns to Draft with the rejection reason).
- **Validity dates are stored but not yet acted upon** — the ongoing expiry-monitoring/reminder engine is
  deferred (later pillar). The Document Master `reminder` cadence is captured as config only.

## Consequences

- The mandatory-doc set is a pure function of `origin` (+ category-specific docs — see open item).
- Document verification is its own review surface with its own RBAC permission and audit entries.
- Object storage for files is required (see ADR-0003 open item / round 4).

## Open

- Category-specific mandatory documents (e.g. bunker → BBM license): counted toward the gate in Phase 0,
  or origin-only for now? → round 4.
- Who may verify vs who may approve — same person allowed to do both? (separation of duties)
