# ADR-0003: Technology stack & monorepo layout

- **Status:** Accepted
- **Date:** 2026-07-13
- **Deciders:** (project owner), Claude

## Context

ADR-0002 committed Phase 0 to a real backend + DB + auth. A concrete, greenfield stack was chosen
(not fitted to an existing platform).

## Decision

TypeScript end-to-end in a **Turborepo** monorepo.

| Concern | Choice |
|---|---|
| Runtime / API | **Bun** + **Hono** |
| Front-ends | **React** — one app per audience |
| ORM / DB | **Drizzle** + **PostgreSQL** |
| Language | **TypeScript** everywhere |
| Validation | shared schema (Zod) reused by API + forms |

Proposed layout:

```
apps/
  api/         Bun + Hono API (auth, registration, master-data, approvals)
  portal/      React — vendor self-service (self-registration, resume draft, upload docs)
  console/     React — staff (office registration, approvals, master-data admin, RBAC)
packages/
  db/          Drizzle schema + migrations (Postgres)
  domain/      shared types, Zod schemas, domain rules (state machine, invariants)
  ui/          shared React components per DESIGN_GUIDELINES.md
```

The existing `vendor_portal.html` / `staff_console.html` become the **visual/interaction reference**
for `apps/portal` / `apps/console`; they are not shipped as-is.

## Open

- **Auth library** on Bun+Hono (candidates: better-auth, Lucia, hand-rolled sessions). Email verification
  required by ADR-0004. → follow-up ADR.
- **Document/object storage** (S3-compatible vs local) → grilling round 3+.
- Deploy target / hosting.

## Consequences

- One language, shared domain package → the state machine & invariants live in code once, reused by both
  front-ends and the API.
- `packages/domain` is the home for the ubiquitous language in `docs/glossary.md`.
