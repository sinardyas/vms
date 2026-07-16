/**
 * Channel policy (M6.1/M6.3, ADR-0016 superseding ADR-0012) — which channels an event reaches a given
 * recipient on.
 *
 * **Every audience gets in-app + email.** The two channels do different jobs, and everyone needs both:
 * email *reaches* someone who isn't signed in, and the in-app row is the *durable record* they can come
 * back to. Email alone is the most perishable channel there is — filtered, buried, sent to a shared
 * mailbox nobody reads.
 *
 * ADR-0012 originally sent vendors email **only**, reasoning that a vendor lives outside the portal and
 * may not sign in for weeks. That argument makes email *necessary* for a vendor; it was read as making
 * email *sufficient*, which it isn't. The audience least likely to be looking at the app is the one with
 * the strongest claim to a persistent record of what it was told — so the vendor gained the in-app
 * channel rather than the internal user losing the email one (ADR-0016).
 *
 * The policy — not the caller — decides the channels, so flipping this is all it took: M6.2's existing
 * `notify()` call sites for `decision` and `doc_rejected` began writing vendor rows with no wiring change.
 *
 * Not to be confused with the vendor's **status view**, which reads the registration record and never
 * this store: a notification says what happened, the status view says what is true now (ADR-0016).
 */

import type { NotificationChannel, UserKind } from "../values";

/**
 * The channels `kind` is notified on, in delivery order (ADR-0016).
 *
 * Uniform across audiences today. The parameter stays because the policy is *by audience* by design —
 * the shape survives if a future audience ever needs to differ, and every caller already passes it.
 */
export const channelsFor = (_kind: UserKind): readonly NotificationChannel[] => ["in_app", "email"];

/** Whether `kind` accumulates in-app rows — i.e. whether the M6.3 centre has anything to show them. */
export const hasInAppChannel = (kind: UserKind): boolean => channelsFor(kind).includes("in_app");
