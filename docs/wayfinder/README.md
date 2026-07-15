# Wayfinder — tracker moved to GitHub Issues

The wayfinder map for **Soechi VMS: prototype → UAT-ready, production-grade Phase-0 app** now lives on
GitHub Issues (migrated from local markdown). GitHub is the **canonical tracker**.

- **Map:** https://github.com/sinardyas/vms/issues/1 — label `wayfinder:map`. Its child tickets are
  **native sub-issues** (see the Sub-issues panel on the map).
- **Tickets:** issues labelled `wayfinder:ticket` + a type label
  (`wayfinder:task` · `research` · `prototype` · `grilling`).

## Wayfinding operations (on GitHub)
- **Claim** — assign the issue to yourself *before* any work (`gh issue edit <n> --add-assignee @me`).
  An open, unassigned ticket is unclaimed.
- **Blocking** — this repo's API exposes no native issue-dependency mutation, so blocking is a **body
  convention**: each ticket's header states `Blocked by: #N`. A ticket is **takeable** when open,
  unassigned, and every `Blocked by` issue is **closed**.
- **Frontier** (takeable now):
  ```bash
  gh issue list -R sinardyas/vms --label wayfinder:ticket --state open
  # then read each open ticket's "Blocked by:" header; takeable = all blockers closed + unassigned
  ```
- **Resolve** — post the answer as an issue **comment**, **close** the issue, and add a one-line entry
  to the map's *Decisions so far* section linking the ticket.
- **Graduate fog** — when a ticket closes, create the newly-specifiable tickets as sub-issues of #1 and
  wire their `Blocked by:` headers; move the graduated item out of the map's *Not yet specified*.

Work the map with `/wayfinder https://github.com/sinardyas/vms/issues/1`. Never resolve >1 ticket/session.
