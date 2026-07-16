/**
 * Channel policy (M6.1, ADR-0012) — which channels an event reaches a given recipient on.
 *
 * ADR-0012 fixes the default by audience, not by event: **vendors → email**, **internal users →
 * in-app + email**. The asymmetry is deliberate. A vendor lives outside the console and may not sign
 * in for weeks, so email is the only channel that reaches them; internal staff are in the console all
 * day, where the bell (M6.3) is the faster surface — but they still get the email so nothing is
 * missed while they're away from it.
 *
 * A consequence worth naming: a vendor's notification is email-only, so **no in-app row is written
 * for them**. The M6.3 portal surface therefore can't be a feed of this store — the vendor's status
 * view reads their registration state instead. Only internal users accumulate rows here.
 */

import type { NotificationChannel, UserKind } from "../values";

/** The channels `kind` is notified on, in delivery order (ADR-0012). */
export const channelsFor = (kind: UserKind): readonly NotificationChannel[] =>
  kind === "vendor" ? ["email"] : ["in_app", "email"];

/** Whether `kind` accumulates in-app rows — i.e. whether the M6.3 centre has anything to show them. */
export const hasInAppChannel = (kind: UserKind): boolean => channelsFor(kind).includes("in_app");
