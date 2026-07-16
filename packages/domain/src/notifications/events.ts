/**
 * The Phase-0 notification event catalogue (M6.1, ADR-0012).
 *
 * The five events Phase-0 ever emits — enumerated here, but **not yet wired**: fixing the catalogue
 * is this milestone's job, firing it at the real call sites is M6.2's. The tuple mirrors the
 * `notifications.event` column (`@vms/db`), which is a plain `varchar(60)` rather than a pg enum,
 * so this is the *only* place the valid set is stated — hence the Zod schema, which is what stops a
 * typo'd event reaching the column (M0.3 tuple+type+Zod pattern).
 */

import { z } from "zod";

export const NOTIFICATION_EVENTS = [
  /** Signup email-verification link. Already delivered by better-auth (M1.1); M6.2 re-points it here. */
  "email_verify",
  /** An approval decision on a vendor's registration — approved/activated, or rejected with reasons. */
  "decision",
  /** A compliance document was rejected by a verifier; a mandatory one bounces the vendor to Draft (M5.3). */
  "doc_rejected",
  /** An approval step opened and was auto-assigned to a decider (ADR-0012 role-lead assignment). */
  "step_assigned",
  /** An office-registered vendor was activated — invite its owner to claim the account (ADR-0004). */
  "office_invite",
] as const;

export type NotificationEvent = (typeof NOTIFICATION_EVENTS)[number];

export const notificationEventSchema = z.enum(NOTIFICATION_EVENTS);
