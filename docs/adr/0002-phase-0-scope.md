# ADR-0002: Phase 0 scope boundary

- **Status:** Accepted
- **Date:** 2026-07-13
- **Deciders:** (project owner), Claude

## Context

`vendor_portal.html` and `staff_console.html` are mockups covering the whole VMS vision. We need a
Phase 0 that is buildable and self-contained. The brainstorm names four mandatory pillars; Phase 0
takes the *onboarding* slice of them.

## Decision

**Phase 0 = Vendor Registration + Master Data, built for real.**

1. **Fidelity:** a real system — database, API, and authentication — not a front-end prototype.
   (Supersedes the brainstorm's "no technology decisions yet" for the onboarding slice.)
2. **Registration includes all four sub-capabilities:** (a) profile data capture, (b) document upload
   at registration, (c) vendor accounts/login, (d) approval workflow (Draft→Pending→Active, incl. HOD).
3. **Both front doors:** vendor **self-registration** (Portal) and **office/on-behalf registration**
   (Console → HOD approval). Full hybrid-onboarding model.
4. **All master-data lists are in scope** — registration lists (Entities, Categories, Banks,
   Currencies, Countries), Document Master, Approval Routes + Users/Roles/RBAC, **and** the operational
   lists (Departments, Vessels, Ports, Tax Codes, SLA).

## Consequences

- Phase 0 is large: it stands up the app's spine (auth, RBAC, master data) that every later phase reuses.
- Deliberate risk accepted: operational lists (Tax, SLA, Vessels, Ports) are managed now even though the
  behavior that *consumes* them (invoicing, ops) is deferred. **Assumption to confirm:** these are built
  as CRUD-managed master data only in Phase 0, with no behavioral wiring — see grilling round 2.
- Document *upload/verification* is in; ongoing document **expiry monitoring/reminders** as a running
  engine remains deferred (later pillar).
- A deploy target and technology stack must now be chosen (ADR-0003+).

## Explicitly out of Phase 0

Invoice submission/tracking/workflow, PO & contracts, document-expiry monitoring engine, dashboards with
real metrics, communications/broadcasts, reports, E-Proc/ERP live integration (export may be manual/stub).
