# ADR-0015: Implementation defaults

- **Status:** Accepted (defaults — override in review)
- **Date:** 2026-07-13
- **Deciders:** (project owner), Claude

## Context

Grilling saturated the design forks (ADR-0002…0014). The remaining choices are implementation-level. We
lock sensible defaults so the build plan is executable; any of these can be changed in code review without
disturbing the domain model.

## Decisions

| Area | Default |
|---|---|
| **Auth** | `better-auth` on Bun+Hono — sessions, email verification, password reset. One `users` table with a `kind` (`vendor` \| `internal`); vendor↔vendor membership modelled for future multi-user (ADR-0009). |
| **Email** | SMTP in prod (Resend or SES adapter); Mailpit/local SMTP in dev. Localized templates (ID/EN). |
| **Enums** | Postgres enums for closed sets: `vendor_status`, `origin`, `approval_trigger`, `verify_status`, `decision`. Everything open/extensible (categories, entities, banks, roles…) is master-data tables. |
| **IDs** | UUID (v7-style, time-ordered) primary keys. |
| **Timestamps** | `timestamptz`, UTC; display in user locale/timezone. |
| **Vendor short-code** | 2-letter code from company name + numeric collision suffix, generated **on activation**. |
| **Draft expiry** | None in Phase 0 (Drafts persist; revisit if abandoned drafts accumulate). |
| **File limits** | MinIO; accept PDF/JPG/PNG; size cap per DESIGN_GUIDELINES (~1.5 MB), configurable; checksum stored. |
| **In-app notifications** | `notifications` table for internal users (console bell); vendors notified by email. |
| **API shape** | Hono + typed handlers; shared Zod schemas from `packages/domain` validate at the edge and in forms. |
| **Testing** | Vitest (unit/domain) + a small e2e suite over golden paths (see build plan M6.5). |

## Consequences

- No further open decisions block Phase 0. The build plan (`docs/phase-0-build-plan.md`) can proceed.
