# ADR-0005: Approval workflow model

- **Status:** Accepted
- **Date:** 2026-07-13
- **Deciders:** (project owner), Claude

## Context

Phase 0 chose a **config-driven routing engine** (not hardcoded transitions) and **full post-activation
edit with re-approval** (bank vs non-bank routes). Both demand a single, generalized mechanism rather
than one-off state flips.

## Decision

### Generalized `ApprovalRequest` aggregate

Every action that needs sign-off raises an **ApprovalRequest**:

| Field | Meaning |
|---|---|
| `subjectVendorId` | the vendor being acted on |
| `trigger` | `NewVendorRegistration` \| `BankChange` \| `NonBankChange` \| `Reactivation` (Blacklist → later) |
| `payload` / `diff` | for edits: the proposed change (not yet applied); for registration: the draft profile |
| `route` | resolved from the **Approval Routes** master by `trigger` |
| `steps[]` | ordered approver **roles** (step1, step2…) with each step's decision {approver, decision, reason, at} |
| `currentStep` | pointer |
| `status` | `Pending` \| `Approved` \| `Rejected` |

### Routing engine

- On submit, the engine resolves the route for the `trigger` from the Approval Routes master (a sequence
  of approver **roles**). A step is actionable by any user holding that role **and** the approve
  permission (RBAC). Approve → advance; last approval → **apply effect**. Reject → stop, return to originator.
- Editing the Approval Routes master reconfigures future requests without code changes.

### Effects & vendor-state interaction

- **Registration** (self or office): Vendor is `Draft` → on submit becomes `Pending`/`Pending-HOD` (the
  open request) → **Approved** ⇒ Vendor `Active`.
- **Edit on an Active vendor:** the vendor **stays `Active` on its current approved values**; the `diff`
  lives on the ApprovalRequest and is applied only on final approval. *(Whether the vendor is flagged
  "change pending" and whether stale-editing is allowed → confirm, round 4.)*

### Reject semantics (proposed; confirmed by non-objection)

- **Registration reject** → Vendor returns to **Draft** with reasons, resumable. (Not a terminal state.)
- **Edit-request reject** → diff discarded; vendor unchanged.

## Open

- Office-registration route: the seeded routes list "New Vendor Registration → AP Staff → AP Supervisor";
  the office/on-behalf path routes to **HOD**. Is that a distinct route or an HOD step? → round 4.
- Concurrent edit requests on one vendor (allow multiple pending? lock?).

## Consequences

- One workflow engine + one audit surface serve registration, bank changes, profile changes, reactivation
  now, and generalize to invoices/POs later.
- The Approval Routes master is load-bearing, not decorative.
