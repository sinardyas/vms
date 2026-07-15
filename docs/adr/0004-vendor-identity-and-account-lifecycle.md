# ADR-0004: Vendor identity & account lifecycle

- **Status:** Accepted
- **Date:** 2026-07-13
- **Deciders:** (project owner), Claude

## Context

Self-registration means an anonymous party creates an account before anyone approves them. We need a
clear relationship between **User account**, **Vendor** aggregate, and **approval state**, plus a
duplicate-prevention rule that works for both local and foreign vendors.

## Decision

### Account-first, resumable draft (self path)

```
signup(email + password) → verify email → authenticated session
   → create/resume Vendor(profile) as Draft   (can log back in and continue)
   → submit → Pending → AP approves → Active
```

- A `User` authenticates; a `Vendor` is the business aggregate. The self-registering user is the
  Vendor's first **sub-user** (owner). Draft/Pending vendors **can log in but cannot transact**.
- **Office path:** staff create the Vendor directly (state `Pending-HOD`). Vendor account/invite
  timing is an **assumption to confirm**: an invite email is issued when HOD **activates** the vendor.

### Uniqueness — Tax ID, per origin

- **Local:** `tax_id` (NPWP) is **hard-unique**. Enforced by a Postgres partial unique index
  (`WHERE origin = 'local' AND tax_id IS NOT NULL`). Required at **submit**, may be blank in Draft.
- **Foreign:** `tax_id` (VAT/BRN) **unique where present**; may be null (some foreign vendors lack one).
- Submitting a profile whose Tax ID already exists is **blocked** with a clear, actionable error.
- A soft fuzzy name/address duplicate *warning* for staff is noted as a later enhancement, not Phase 0.

## Consequences

- Schema: `users`, `vendors`, `vendor_sub_users` (or a membership join). Vendor carries `origin`,
  `tax_id`, `status`. Partial unique indexes encode the identity invariant in the DB, not just app code.
- The email-verification + invite flows require an email-sending capability in Phase 0.
- "Draft" is a first-class, resumable state — not a throwaway. Draft cleanup/expiry policy is open.

## Open

- Office-path account/invite timing (assumption above) — confirm.
- Reject semantics: does an AP/HOD rejection send the vendor back to Draft with reasons, or a terminal
  Rejected state? → grilling round 3.
