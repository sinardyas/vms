# ADR-0009: Phase 0 workflow specifics — routes, SoD, gate scope, sub-users

- **Status:** Accepted
- **Date:** 2026-07-13
- **Deciders:** (project owner), Claude

## Decisions

### Seed approval routes (2-step, as designed)

| Trigger | Step 1 | Step 2 |
|---|---|---|
| New Vendor Registration (self) | AP Staff | AP Supervisor / Asst. Manager |
| Office Vendor Registration | HOD | — |
| Bank Change | AP Staff | AP Manager |
| Non-Bank Change | AP Staff | AP Supervisor / Asst. Manager |
| Reactivation (Inactive→Active) | AP Manager | — |

Routes are seed data in the **Approval Routes** master and drive the ADR-0005 engine; admins can edit them.

### Separation of duties (enforced server-side)

1. **Verifier ≠ approver** for the same vendor: a user who verified any document on a vendor cannot act as
   an approver on that vendor's registration/edit request.
2. **No self-approval:** the submitter of a registration/edit cannot approve it at any step.

Violations are blocked at the API (403) and the eligible-approver set excludes disqualified users.

### Document-gate scope — origin **+ category**

Amends ADR-0007. The mandatory-document set = origin-based docs **plus** the vendor's category-specific
docs (e.g. bunker → BBM Trading License, crewing → SIUPPAK). Therefore **Document Master** gains
**category applicability** (a doc applies to: all / a specific vendor category), alongside its existing
`applies_to` origin field. The activation gate checks both sets are `Verified`.

### Vendor sub-users — single owner (Phase 0)

The self-registering person is the vendor's sole login. Multi-user invite + per-user access is **deferred**.
Schema still models the User↔Vendor link as a membership so multi-user is an additive change, not a rewrite.

## Consequences

- `document_master` schema: add `category_id` (nullable = origin-only) or an applicability table.
- The engine needs the acting user's history (did they verify? did they submit?) to compute eligibility.
- Office registration is a first-class route (→ HOD), distinct from self-registration.

## Remaining low-risk opens (recommended defaults; confirm any time)

- **Auth/email:** better-auth on Bun+Hono; email verification + notifications via SMTP/Resend. (→ ADR when picked.)
- **Draft expiry:** unactivated Drafts never auto-delete in Phase 0 (revisit if abandoned drafts pile up).
- **Office-path account:** vendor invite email issued on HOD **activation** (ADR-0004 assumption, still open).
