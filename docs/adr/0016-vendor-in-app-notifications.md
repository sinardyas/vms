# ADR-0016: Vendors get in-app notifications; the status view reads real state

- **Status:** Accepted
- **Date:** 2026-07-17
- **Deciders:** (project owner), Claude

## Context

ADR-0012 fixed the notification channel default **by audience**: vendors → **email**; internal users →
**in-app + email**. The reasoning was that a vendor lives outside the console and may not sign in for
weeks, so email is the only channel that reaches them.

Building M6.3 (the in-app notification centre) surfaced the consequence that reasoning had not
followed through to. "Vendors → email" means **no in-app row is ever written for a vendor**, so the
vendor half of the notification centre would render a permanently empty feed. M6.1 named this and
routed around it, proposing that the portal's notification surface be the registration status view
rather than a feed.

That routing-around holds up only if email is a *sufficient* record, and it isn't. Email is the
channel most likely to be lost — filtered, buried, sent to a shared `info@` mailbox nobody reads, or
forwarded to a colleague who has since left. The argument that made email *necessary* for vendors
("they're not in the portal every day") is not an argument that it is *sufficient*; it says a vendor
needs to be reached where they are, not that they should have nothing durable to come back to. The
audience that most needs a persistent record of what it was told is precisely the one that ADR-0012
gave the most perishable channel and nothing else.

There is a second, separate need that a feed does not serve. "Where is my registration, and what do I
have to do next?" should be answerable with **zero navigation** — on the page the vendor already
lands on, from the vendor's actual record, not from the history of messages we happened to send. A
notification is a report of a past event; the status view is the present state. A vendor reading a
three-week-old "returned to Draft" notice needs to know whether that is *still* true.

## Decisions

### Channel policy — vendors get in-app + email (supersedes ADR-0012)

`channelsFor(kind)` returns `["in_app", "email"]` for **every** audience. Email keeps its ADR-0012
job of reaching people who aren't signed in; the in-app row becomes the durable record that survives
a lost inbox. The asymmetry is removed, not inverted — vendors gain a channel, they don't lose one.

Consequence: no call site changes. M6.2 already dispatches `decision` and `doc_rejected` to vendor
owners through `notify()`; those events begin writing rows the moment the policy flips, because the
policy — not the caller — decides the channels.

### The status view reads state, not notifications

The vendor's registration status view is **not** a feed and must never be built from the
notifications store. It reads the record: the vendor's lifecycle status, the deciding
`approval_steps.reason` for a rejection, and each document's `verifyStatus` + `rejectReason`.

The two surfaces answer different questions and are allowed to overlap:

| Surface | Question | Source |
|---|---|---|
| Notification bell | "What was I told?" | `notifications` (append-only history) |
| Status view | "Where am I now, and what's next?" | `vendors` / `approval_steps` / `document_versions` |

A notification is immutable once written and can go stale; the status view is always current. Neither
is derivable from the other, which is why both exist.

### The centre is self-scoped, not an RBAC module

Reading your own notifications requires **authentication only** — no RBAC module, following the
`GET /me` precedent (ADR-0011/M1.3). The scope is identity: a caller may read and mark-read exactly
their own rows, never anyone else's, and the user id comes from the session rather than the request.
"What was I told?" is no more a permission subject than "what may I do?" is. Adding a tenth RBAC
module for it would ripple into `role_permissions`, the seed, and every role's grid to express a
grant that is never legitimately withheld.

### Rows render at read time, in the reader's locale

Unchanged from M6.1 and restated because the vendor feed now depends on it: a row stores
`titleKey`/`bodyKey`/`params`, never rendered copy, and renders on read. For a self-scoped read the
actor **is** the recipient, so the request locale is the reader's language — the actor/recipient
locale divergence that forced `users.locale` (M6.1) does not arise here. Rendering from the row's
**stored** keys (rather than re-deriving them from the event) keeps an already-written row honest if
the template's branching logic later changes.

## Consequences

- `channelsFor` loses its audience branch; `hasInAppChannel` is true for everyone.
- Vendors accumulate rows from `decision`, `doc_rejected`, and `office_invite`. `email_verify`
  predates the account's usable session, so its row is written but only ever read after sign-in —
  harmless, and cheaper than special-casing an event out of the policy.
- M6.1's "the portal surface can't be a feed" note is superseded; its reasoning is preserved above.
- M6.2's tests asserting "vendor → email only, no in-app row" encoded the old policy and are updated
  to assert the new one.
- The portal gains a bell; both apps mount the same `@vms/ui` component over the same API.

## Supersedes

- ADR-0012 "Channel default: vendors → **email**" → **all audiences → in-app + email** here.
