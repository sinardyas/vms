# ADR-0001: Record architecture decisions

- **Status:** Accepted
- **Date:** 2026-07-13
- **Deciders:** (project owner), Claude

## Context

We are moving from UI mockups (`vendor_portal.html`, `staff_console.html`) toward an implemented
system, starting with **Phase 0 = vendor registration + master data**. Decisions made during the
grilling/design sessions need to be durable and reviewable so later phases don't relitigate them.

## Decision

We keep an ADR log under `docs/adr/`. Each significant decision gets its own numbered file
(`NNNN-title.md`) with: Status, Context, Decision, Consequences. Ubiquitous language lives in
`docs/glossary.md`; the evolving domain picture lives in `docs/phase-0-domain-model.md`.

## Consequences

- Decisions are cheap to find and cite in PRs.
- "Why is it like this?" has an answer that isn't a Slack thread.
- ADRs are append-only in spirit: supersede rather than silently edit once Accepted.

## ADR index

| # | Title | Status |
|---|---|---|
| 0001 | Record architecture decisions | Accepted |
| 0002 | Phase 0 scope boundary | Accepted |
| 0003 | Technology stack & monorepo layout | Accepted |
| 0004 | Vendor identity & account lifecycle | Accepted |
| 0005 | Approval workflow model | Accepted |
| 0006 | Tenancy — group-level vendor, multi-entity master | Accepted |
| 0007 | Document verification & activation gate | Accepted |
| 0008 | Storage, localization, RBAC & audit depth | Accepted |
| 0009 | Phase 0 workflow specifics — routes, SoD, gate scope, sub-users | Accepted |
| 0010 | Assignment, recall, uniqueness predicate, document validity | Accepted |
| 0011 | RBAC combination, master-data i18n, doc versioning, audit granularity | Accepted |
| 0012 | RBAC module set, E-Proc export, notifications, initial assignment | Accepted |
| 0013 | Document scope & category requirements | Accepted |
| 0014 | Workflow sequencing — verification, freezing, escalation | Accepted |
| 0015 | Implementation defaults | Accepted |

See also: `../phase-0-domain-model.md` (the model), `../phase-0-build-plan.md` (the execution sequence),
`../glossary.md` (ubiquitous language).
