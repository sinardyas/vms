# ADR-0017: Hide out-of-phase sections; land on a minimal Phase-0 dashboard

- **Status:** Accepted
- **Date:** 2026-07-17
- **Deciders:** (project owner), Claude
- **Reverses:** the shell-visibility decision recorded in #9 and #90 (see _Reverses_ below)

## Context

Issue #9 established the **ComingSoon shell**: out-of-Phase-0 sections (Invoicing, Contracts,
Communications, Reports, and — since #90 — the Dashboard) keep their nav entry, rendered dimmed with
a `soon` pill, and route to an honest "Later Phase" panel instead of a dead link or a fake screen.
The stated purpose was UAT: stakeholders navigate the **whole** product map while testing only the
built Phase-0 slice, and the shell makes a stub unmistakable as a stub.

A grilling session (2026-07-17) surfaced that the mechanism is not achieving its purpose. Testers
report the opposite of clarity: **too many `soon` entries read as noise**, and at least one tester was
confused by them — a confusion the shell was specifically designed to prevent. That is a design
failure of the shell treatment, acknowledged and **deferred** here rather than fixed (the shells are
about to become unreachable, so fixing their copy would be polishing dead code — see the deferred
ticket).

Two facts constrain the fix:

1. **UAT and production ship the same build.** There is no separate "UAT" artifact. Whatever hides
   the sections in UAT hides them in production, and whatever reveals them reveals them in both.
2. **The reveal trigger is a deploy, not a date.** A section becomes real when its screen ships in
   code. Nothing else legitimately flips it from stub to feature.

The request that opened the session — "hide everything `soon` to reduce distraction" — was sharpened
against those facts into the decisions below. Scope is **both apps**: console (`invoices`,
`contracts`, `communications`, `reports`, `dashboard`) and portal (`invoices`, `orders`, `messages`).

## Decisions

### Out-of-phase sections are hidden, not shelled

A section without a built screen is **absent from the nav and unreachable**, in both console and
portal. The dimmed-item + `soon`-pill treatment and the `ComingSoon` route target are retired from
the live navigation. The product-map-during-UAT rationale of #9 is knowingly given up: the project
owner's call is that reduced distraction for testers (who graduate directly to production) outweighs
roadmap visibility, in both environments, for now.

### Visibility is derived from the code, not a runtime flag (fail-closed)

A section is visible **iff its screen is registered in the app**. There is no free-floating "hide
soon" toggle. This **fails closed by construction**: no operator action can expose a section whose
screen does not exist, because there is no action to get wrong. Revealing a section = shipping its
build with the section registered — one direction, once, in lockstep with the deploy, impossible to
desync. Given that UAT and production are the same artifact (constraint 1), an environment flag would
be identical in both and buys nothing; a per-feature runtime flag would only re-introduce the
desync-and-expose hazard the grilling was trying to remove.

**Deferred alternative — per-feature runtime flag.** A runtime flag earns its place only for one
need: a section that is **built and already deployed**, held back, then revealed on a business
trigger (UAT sign-off, a go-live date) **without a redeploy**. That need does not exist yet. If it
arises, add a **per-feature** flag (never one global `hideSoon` switch — a global switch would
un-hide still-unbuilt Phase-2 stubs the moment Phase 1 ships, resurfacing the exact confusion this
ADR removes) and keep it **fail-closed**: `flag on + screen missing → render the work surface, never
a shell.` The flag may only ever hide a built screen, never conjure an unbuilt one.

### Hidden routes fall to the work surface, never a shell

A deep link or stale bookmark to a hidden section (e.g. `/invoices`) resolves to the Phase-0 **work
surface**, not to a `ComingSoon` panel and not to a blank route. This preserves #90's "unrecognized
link → work surface, not the Dashboard" behaviour and extends it to now-hidden keys.

### The console gets a minimal Phase-0 dashboard (reverses #90)

#90 cut the console dashboard to a `soon` shell and landed staff on the work surface, on the grounds
that "dashboards with real metrics" are Phase 1. This ADR **reverses that** for a deliberately thin
slice: a real `dashboard` screen showing exactly two widgets, both fed by existing Phase-0 data —

| Widget | Source | Existing screen it summarizes |
|---|---|---|
| Document Verification queue | `document_versions` / verification endpoint | Document Verification |
| Vendor list | `vendors` | Vendors |

The reversal is made **with eyes open**: the dashboard duplicates two lists already reachable from
the nav, and its only new value is an at-a-glance landing. The invoice/SLA/payables widgets in the
`staff_console.html` prototype's "Operations Dashboard" are **explicitly out of scope** — they
summarize `soon` (Phase-1) features and cannot appear until those features are built. If the
two-widget landing proves to carry no value the nav doesn't already, it should be dropped and the
console left landing on the work surface, i.e. #90 restored.

**Open — default landing.** Whether the new dashboard becomes the default landing (replacing the
work-surface landing from #90) is left to the build ticket, not decided here.

## Consequences

- Nav config in `apps/console/src/App.tsx` and `apps/portal/src/App.tsx` no longer emits `soon`
  items; the `SOON_KEYS` routing and the `soon`/`ComingSoon` branches are removed from the live path.
- `packages/ui/src/components/coming-soon.tsx` and the `app-shell.tsx` `soon`-pill treatment become
  **unreferenced**. Their fate (delete, or keep for a future reveal path and fix the copy) is the
  deferred ticket, so #7/#10's confusion doesn't silently evaporate.
- The console gains `apps/console/src/features/dashboard.tsx` (absent since #90) with two widgets over
  existing endpoints — no new backend.
- Roadmap visibility is lost in production too, not just UAT. Accepted as the owner's call (#4 of the
  grilling). Revisit if production customers need a "coming soon" signal.
- Revealing a Phase-1 section is a code change (register the screen), reviewable in a PR — not an ops
  toggle. Add the deferred per-feature flag only when reveal-without-redeploy becomes a real need.

## Reverses

- **#9** "Coming soon shells for out-of-Phase-0 sections" — the shells are removed from live nav;
  out-of-phase sections are hidden, not shelled.
- **#90** "Console shell honesty — dashboard shell" — the console dashboard returns as a real,
  minimal Phase-0 screen instead of a `soon` shell.
