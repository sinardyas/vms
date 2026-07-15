# ADR-0010: Assignment, recall, uniqueness predicate, document validity

- **Status:** Accepted
- **Date:** 2026-07-13
- **Deciders:** (project owner), Claude

## Decisions

### Approval steps are assigned to a named user (reassignable)

- Each `ApprovalRequest.step` carries an `assigneeUserId`. Ownership is explicit; an assignee (or an
  admin/manager) can **reassign** to another eligible user.
- **Initial assignment (proposed default):** on entering a step, the engine auto-assigns to an eligible
  user holding the step's role — round-robin / least-open-load — **excluding** SoD-disqualified users
  (the submitter, and anyone who verified a document on this vendor; ADR-0009). Reassignment is manual.
  *(Open: auto round-robin vs. a human dispatcher picks — confirm.)*
- Advancing to step 2 triggers a fresh assignment for that step's role.

### Submitter can recall a Pending request (pre-decision only)

- Before **any** step decision is recorded, the submitter may **recall** the request → Vendor returns to
  `Draft`; edit; resubmit (new request). After the first approval exists, recall is closed — changing it
  then requires a **reject** (→ Draft with reasons). Keeps "what was approved is what you get" once review
  has started.

### Tax-ID uniqueness — enforced among non-Draft records

- Postgres **partial unique index**: `UNIQUE (tax_id) WHERE status <> 'Draft' AND tax_id IS NOT NULL`
  (scoped per origin as needed). Two Drafts may share a Tax ID; the collision is caught **at submit** —
  first to submit wins, the second gets a clear, actionable error. Preserves parallel/resumable drafting.

### Document validity — vendor enters real dates, verifier confirms

- On upload the vendor enters the certificate's **issue** and **expiry** dates. `validUntil` = the entered
  expiry (the printed truth), **not** `upload + validityDays`. The verifier confirms dates against the scan
  as part of verification. Document Master `validityDays` becomes an **expectation/hint** (e.g. warn if the
  entered span is wildly off), not the source of truth.

## Consequences

- `approval_request_steps` gains `assignee_user_id` + reassignment history (audited).
- Eligible-assignee computation depends on SoD + role + RBAC approve permission.
- `vendor_documents` gains `issued_on`, `expires_on` (= validUntil); required at verification.
- The uniqueness predicate must also be re-checked in the submit transaction (index enforces; app gives the
  friendly message + points at the existing vendor).

## Open

- Initial-assignment strategy: auto round-robin (default) vs human dispatcher.
