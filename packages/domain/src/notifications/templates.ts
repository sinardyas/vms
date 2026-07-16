/**
 * Notification templates (M6.1, ADR-0008/0012) — one per event type, bilingual, rendered from the
 * `@vms/domain` catalogue.
 *
 * A template is **keys, not copy**: an event resolves to a set of `MessageKey`s plus the params that
 * interpolate into them, and rendering happens against a locale at the last moment. That indirection
 * is what lets one stored in-app row (which persists `titleKey`/`bodyKey`/`params`, never rendered
 * text) re-render in whichever language its reader picks up later.
 *
 * Each event's params are a Zod schema — the single source of validation (Definition-of-Done), and
 * the thing that guarantees a template's `{tokens}` actually have values. Unmatched tokens survive
 * interpolation verbatim (see `i18n/resolve.ts`), so an unvalidated param would ship a literal
 * `{vendorName}` to a vendor; the schemas below are what make that unreachable.
 *
 * `email_verify` deliberately reuses the existing `auth.email.verify.*` keys rather than restating
 * that copy: M1.1 already wrote and translated it, and M6.2 re-points better-auth's callback at this
 * service, so the two must render identically — sharing the keys makes drift impossible rather than
 * merely unlikely.
 */

import { z } from "zod";
import { type MessageKey, translate } from "../i18n";
import type { Locale } from "../values";

// --- Per-event params ---------------------------------------------------------------------------

/** Every notification greets its recipient by name and offers one link to act on. */
const baseParams = {
  /** The recipient's display name — `{name}` in the body. */
  name: z.string().min(1),
  /** Absolute URL the CTA points at. Built by the caller (the API knows the portal/console origins). */
  url: z.string().min(1),
};

export const emailVerifyParamsSchema = z.object({ ...baseParams });

export const decisionParamsSchema = z
  .object({
    ...baseParams,
    vendorName: z.string().min(1),
    outcome: z.enum(["approved", "rejected"]),
    /** Why it was rejected. Required on a rejection — ADR-0012 says "reject-with-reasons". */
    reason: z.string().min(1).optional(),
  })
  .refine((p) => p.outcome !== "rejected" || !!p.reason, {
    path: ["reason"],
    message: "A rejection decision must carry a reason",
  });

export const docRejectedParamsSchema = z.object({
  ...baseParams,
  vendorName: z.string().min(1),
  /** The document type's resolved (already localized) name — e.g. "Akta Pendirian". */
  documentName: z.string().min(1),
  reason: z.string().min(1),
  /** Whether rejecting this doc bounced the registration back to Draft (M5.3 — mandatory only). */
  returnedToDraft: z.boolean(),
});

export const stepAssignedParamsSchema = z.object({
  ...baseParams,
  vendorName: z.string().min(1),
  /** The step's role name, resolved in the recipient's locale by the caller. */
  roleName: z.string().min(1),
});

export const officeInviteParamsSchema = z.object({
  ...baseParams,
  vendorName: z.string().min(1),
});

/**
 * A dispatchable notification: the event plus exactly the params its template interpolates.
 * Discriminated on `event`, so the compiler pairs each event with its own param shape.
 */
export const notificationInputSchema = z.discriminatedUnion("event", [
  z.object({ event: z.literal("email_verify"), params: emailVerifyParamsSchema }),
  z.object({ event: z.literal("decision"), params: decisionParamsSchema }),
  z.object({ event: z.literal("doc_rejected"), params: docRejectedParamsSchema }),
  z.object({ event: z.literal("step_assigned"), params: stepAssignedParamsSchema }),
  z.object({ event: z.literal("office_invite"), params: officeInviteParamsSchema }),
]);

export type NotificationInput = z.infer<typeof notificationInputSchema>;

// --- Template resolution ------------------------------------------------------------------------

/**
 * The keys one notification renders from.
 *
 * `subjectKey` is the email subject line; `titleKey` is the in-app row's heading (shorter — it sits
 * in a dropdown, not an inbox). They differ per channel, which is why both are carried.
 */
export type ResolvedTemplate = {
  readonly subjectKey: MessageKey;
  readonly titleKey: MessageKey;
  readonly bodyKey: MessageKey;
  readonly ctaKey: MessageKey;
};

/**
 * The template for `input`. Two events branch on their params rather than getting separate event
 * types, because the *event* is one thing and only the wording differs:
 *   - `decision` — an approval reads nothing like a rejection, and a rejection must carry its reason.
 *   - `doc_rejected` — a mandatory rejection sends the vendor back to Draft (M5.3) and must say so;
 *     an optional one is advisory and must not imply the registration moved.
 */
export const resolveTemplate = (input: NotificationInput): ResolvedTemplate => {
  switch (input.event) {
    case "email_verify":
      return {
        subjectKey: "auth.email.verify.subject",
        titleKey: "auth.email.verify.heading",
        bodyKey: "auth.email.verify.body",
        ctaKey: "auth.email.verify.cta",
      };
    case "decision":
      return input.params.outcome === "approved"
        ? {
            subjectKey: "notify.decision.approved.subject",
            titleKey: "notify.decision.approved.title",
            bodyKey: "notify.decision.approved.body",
            ctaKey: "notify.decision.approved.cta",
          }
        : {
            subjectKey: "notify.decision.rejected.subject",
            titleKey: "notify.decision.rejected.title",
            bodyKey: "notify.decision.rejected.body",
            ctaKey: "notify.decision.rejected.cta",
          };
    case "doc_rejected":
      return input.params.returnedToDraft
        ? {
            subjectKey: "notify.docRejected.mandatory.subject",
            titleKey: "notify.docRejected.mandatory.title",
            bodyKey: "notify.docRejected.mandatory.body",
            ctaKey: "notify.docRejected.mandatory.cta",
          }
        : {
            subjectKey: "notify.docRejected.optional.subject",
            titleKey: "notify.docRejected.optional.title",
            bodyKey: "notify.docRejected.optional.body",
            ctaKey: "notify.docRejected.optional.cta",
          };
    case "step_assigned":
      return {
        subjectKey: "notify.stepAssigned.subject",
        titleKey: "notify.stepAssigned.title",
        bodyKey: "notify.stepAssigned.body",
        ctaKey: "notify.stepAssigned.cta",
      };
    case "office_invite":
      return {
        subjectKey: "notify.officeInvite.subject",
        titleKey: "notify.officeInvite.title",
        bodyKey: "notify.officeInvite.body",
        ctaKey: "notify.officeInvite.cta",
      };
  }
};

/** One notification rendered into a locale — the strings a channel actually ships. */
export type RenderedNotification = {
  readonly subject: string;
  readonly title: string;
  readonly body: string;
  readonly cta: string;
};

/**
 * Render `input` into `locale`. Pure — pass the *recipient's* locale, never the acting request's:
 * the whole point of a notification is that it addresses someone other than the actor.
 */
export const renderNotification = (
  input: NotificationInput,
  locale: Locale,
): RenderedNotification => {
  const template = resolveTemplate(input);
  // Zod validated these; the cast narrows the discriminated union's params to the flat token bag
  // `translate` interpolates from (booleans never appear in copy — they select the template).
  const params = input.params as Readonly<Record<string, string | number>>;
  return {
    subject: translate(template.subjectKey, locale, params),
    title: translate(template.titleKey, locale, params),
    body: translate(template.bodyKey, locale, params),
    cta: translate(template.ctaKey, locale, params),
  };
};
