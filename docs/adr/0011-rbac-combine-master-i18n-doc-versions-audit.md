# ADR-0011: RBAC combination, master-data i18n, document versioning, audit granularity

- **Status:** Accepted
- **Date:** 2026-07-13
- **Deciders:** (project owner), Claude

## Decisions

### Approval authority = route role **AND** module approve-permission
- To act on a workflow step, a user must **both** hold the step's **role** (from the Approval Route) **and**
  have the **`approve`** permission on the relevant module (RBAC). Document verification likewise requires the
  Documents-module verify/approve permission.
- **Eligible approver set** = `role holders ∩ approve-permission holders − SoD-disqualified` (ADR-0009/0010).
- **Deadlock guard (required):** because both are needed, a role without the matching permission means *nobody*
  can approve. Mitigations: (a) seed each approver role with the approve permission on the modules it approves;
  (b) when saving an Approval Route or RBAC change, **warn** if the referenced role has zero eligible approvers;
  (c) surface "0 eligible approvers" on a stuck request.

### Master-data labels — per-locale columns
- Master rows carry `name_id` + `name_en` (and description variants where shown). UI renders the active locale,
  falls back to the other if blank. Enum/business **codes stay language-neutral**; only labels are localized.
  Applies to: vendor_categories, business_entities, soechi_entities, departments, roles, document_master names,
  tax_codes, sla stage labels, etc. Banks/countries/currencies keep their proper names + code.

### Documents — versioned with a current pointer
- Each upload is an **immutable version** (`file_id`, `issued_on`, `expires_on`, `uploaded_by`, `at`,
  `verify_status`, `verified_by`, `reject_reason`). The document slot references the **current** version.
  Rejected/replaced scans are retained for audit & disputes. **One current file per doc type** (multi-file
  per slot not needed in Phase 0).

### Audit — action log only (amends ADR-0008)
- Audit records **who / action / subject(type,id) / when / ip / user-agent** — **no field-level before/after
  diffs**. Append-only. History reconstruction relies on document versions + approval-request records for the
  high-risk data; routine field history is intentionally out of scope for Phase 0.

## Consequences

- RBAC seed must be internally consistent with the seeded Approval Routes (see deadlock guard).
- Every master edit form gains ID/EN label fields; reads join/select by locale.
- `documents` splits into `document_slots` (per vendor+type, current pointer) + `document_versions`.
- Audit table is a single append-only log; it will not answer "what was this field previously" for master data.

## Supersedes

- ADR-0008 "full audit … before/after (or diff)" → refined to **action-log-only** here.
