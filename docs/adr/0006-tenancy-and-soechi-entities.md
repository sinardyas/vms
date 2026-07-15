# ADR-0006: Tenancy — group-level vendor, multi-entity master

- **Status:** Accepted
- **Date:** 2026-07-13
- **Deciders:** (project owner), Claude

## Context

Brainstorm Open Question #1: single legal entity or a group of Soechi entities. Soechi operates vessels
across several legal companies. We must decide whether the Vendor record is scoped per company.

## Decision

- **A Vendor is a single, group-level shared record.** No `org_id` scoping on `vendors` or master-data
  tables in Phase 0. One registration serves the whole group.
- **Introduce a `soechi_entities` master list** — the group's own legal companies — as reference data.
  This is **distinct** from the vendor's own **Business Entity** legal-form list (PT/CV/LLC…). Naming in
  code/UI must keep them apart to avoid the "entity" collision.
- Linking a Soechi entity to a transaction (PO/contract/invoice) is a **later-phase** concern; Phase 0
  only maintains the list.

## Consequences

- Simpler schema now; no tenant plumbing threading through every query.
- Glossary must disambiguate **Business Entity** (vendor legal form) vs **Soechi Entity** (group company).
- If per-entity vendor separation is ever required, it becomes a migration (add scoping), not a day-0 tax.

## Naming guard

| Term | Refers to | Table |
|---|---|---|
| Business Entity | vendor's legal form (PT, CV, Pte. Ltd.) | `business_entities` |
| Soechi Entity | a Soechi group company | `soechi_entities` |
