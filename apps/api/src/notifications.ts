/**
 * Notification dispatch (M6.1, #77, ADR-0008/0012) — the delivery half of the notification service.
 *
 * `@vms/domain`'s notification module owns the *what* (event catalogue, channel policy, templates);
 * this owns the *how* — resolving the recipient, rendering in their language, and pushing the result
 * onto each channel. Kept apart so the templates stay stack-neutral and unit-testable without a
 * database or an SMTP server.
 *
 * **The catalogue is enumerated here but not yet fired.** Wiring the five events at their real call
 * sites (the M5.3 `VerificationNotifier` seam, M4.2's decide effects, M1.1's email-verify) is M6.2's
 * job; this milestone's contract is that `notify()` exists and works when they call it.
 *
 * Two properties worth stating up front, because callers depend on them:
 *
 * 1. **`notify()` never throws.** It reports what was delivered and swallows (logging) what wasn't.
 *    A notification is a side effect of a state change that has *already committed* — the M5.3 seam
 *    fires after its transaction precisely so a delivery failure can't undo the bounce. If this
 *    function threw, a Mailpit outage would 500 a request whose work had succeeded, and the caller
 *    would have no way to tell the two apart. Undelivered mail is a worse outcome than delivered
 *    mail, but a far better one than a lost state transition.
 *
 * 2. **Rendering uses the recipient's locale, never the request's.** `RequestContext.locale` is the
 *    language of the *response* — the actor's. Notifications are the one place those diverge by
 *    construction: a verifier working in English rejects a document and an Indonesian vendor must
 *    read the rejection in Indonesian. Hence `users.locale` (M6.1, migration `0005`).
 */

import { type DB, db, notifications, users } from "@vms/db";
import {
  type Locale,
  type NotificationChannel,
  type NotificationEvent,
  type NotificationInput,
  type UserKind,
  channelsFor,
  notificationInputSchema,
  parseWith,
  renderNotification,
  resolveTemplate,
  translate,
} from "@vms/domain";
import { eq } from "drizzle-orm";
import { sendRenderedEmail } from "./email";

/** Anything that can run a Drizzle insert — the ambient `db` or an open transaction (cf. `AuditSink`). */
export type NotificationSink = Pick<DB, "insert">;

/** Who a notification is for, and everything delivery needs to know about them. */
export type NotificationRecipient = {
  readonly userId: string;
  readonly email: string;
  readonly name: string;
  /** The language *they* read — `users.locale`, not the acting request's. */
  readonly locale: Locale;
  /** Drives the channel policy: vendors → email; internal → in-app + email (ADR-0012). */
  readonly kind: UserKind;
  readonly active: boolean;
};

/** The params of one specific event, pulled off the discriminated union. */
type ParamsOf<E extends NotificationEvent> = Extract<NotificationInput, { event: E }>["params"];

/**
 * A dispatch request: who, which event, and the event's own params.
 *
 * `name` is deliberately absent — the service fills it from the recipient's row. A caller that
 * passed a name could disagree with the record, and there's no reason to make them fetch a user
 * this function loads anyway.
 */
export type NotifyRequest<E extends NotificationEvent = NotificationEvent> = {
  /** The recipient's user id. */
  readonly to: string;
  readonly event: E;
  readonly params: Omit<ParamsOf<E>, "name">;
};

/** Why a notification wasn't attempted at all (as opposed to attempted and failed). */
export type NotifySkip =
  /** No such user — a dangling id; nothing to deliver to. */
  | "unknown-recipient"
  /** The account is deactivated: mail to a disabled user is noise, and their bell is unreachable. */
  | "inactive-recipient"
  /** The params didn't satisfy the event's schema — delivering would ship `{tokens}` as literal text. */
  | "invalid-params";

/** What dispatch actually managed to do. Every channel lands in exactly one of the two lists. */
export type NotifyOutcome = {
  readonly delivered: readonly NotificationChannel[];
  readonly failed: readonly NotificationChannel[];
  readonly skipped?: NotifySkip;
};

/**
 * Append one in-app notification row.
 *
 * Takes a sink rather than importing the ambient `db`, exactly as `writeAudit` does — so a mutation
 * that wants its notification to be part of the change can pass its open transaction and have the
 * row commit atomically with it, while a caller firing after commit passes `db`.
 *
 * The row stores **keys and params, never rendered copy**. A notification written for an Indonesian
 * reader has to render in English if they switch the console's language, so the locale is applied at
 * read time (M6.3) rather than frozen here.
 */
export const writeInAppNotification = async (
  sink: NotificationSink,
  userId: string,
  input: NotificationInput,
): Promise<void> => {
  const template = resolveTemplate(input);
  await sink.insert(notifications).values({
    userId,
    event: input.event,
    channel: "in_app",
    titleKey: template.titleKey,
    bodyKey: template.bodyKey,
    params: input.params,
    link: input.params.url,
  });
};

/** Load the recipient's identity + language. `null` when the id doesn't resolve. */
export const loadRecipient = async (userId: string): Promise<NotificationRecipient | null> => {
  const [row] = await db
    .select({
      userId: users.id,
      email: users.email,
      name: users.name,
      locale: users.locale,
      kind: users.kind,
      active: users.active,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return row ?? null;
};

/**
 * How long a tokenized link stays good, per event — the small print under the CTA.
 *
 * Two of the five events carry a *token*, not a plain deep link: `email_verify` (better-auth's
 * verification token, `emailVerification.expiresIn`) and `office_invite` (the password-set token
 * minted by `requestPasswordReset`). Both expire, and an email that doesn't say so leaves the reader
 * to discover it by clicking a dead link. The other three point at a durable page and have no
 * expiry to state. Mirrors the note `sendLinkEmail` already puts on M1.1's auth mail — which is why
 * re-pointing verify through this service (M6.2) doesn't quietly drop its footer.
 */
const LINK_EXPIRY_MINUTES: Partial<Record<NotificationEvent, number>> = {
  email_verify: 60,
  office_invite: 60,
};

/** Send one notification as an email, rendered into the recipient's locale. */
const sendNotificationEmail = async (
  recipient: NotificationRecipient,
  input: NotificationInput,
): Promise<void> => {
  const rendered = renderNotification(input, recipient.locale);
  const minutes = LINK_EXPIRY_MINUTES[input.event];
  await sendRenderedEmail({
    to: recipient.email,
    locale: recipient.locale,
    subject: rendered.subject,
    heading: rendered.title,
    body: rendered.body,
    cta: rendered.cta,
    url: input.params.url,
    footerLines:
      minutes === undefined
        ? undefined
        : [
            translate("auth.email.expiry", recipient.locale, { minutes }),
            translate("auth.email.ignore", recipient.locale),
          ],
  });
};

/**
 * The injectable edges of dispatch — the database and the mail transport. Defaulted to the real
 * ones, overridden in tests so the delivery rules can be exercised without Postgres or SMTP.
 */
export type NotifyDeps = {
  readonly loadRecipient: (userId: string) => Promise<NotificationRecipient | null>;
  readonly writeInApp: (
    recipient: NotificationRecipient,
    input: NotificationInput,
  ) => Promise<void>;
  readonly sendEmail: (recipient: NotificationRecipient, input: NotificationInput) => Promise<void>;
};

const defaultDeps: NotifyDeps = {
  loadRecipient,
  // Fires after the caller's transaction, so the row gets its own — see the header note on why the
  // in-app write is not, by default, part of the mutation it reports.
  writeInApp: (recipient, input) => writeInAppNotification(db, recipient.userId, input),
  sendEmail: sendNotificationEmail,
};

/**
 * Dispatch one notification: resolve the recipient → render in their locale → deliver on every
 * channel their audience gets (ADR-0012).
 *
 * Never throws — see the header. Channels are independent: a dead SMTP host must not cost an
 * internal user the in-app row that would have told them the same thing.
 */
export const notify = async <E extends NotificationEvent>(
  request: NotifyRequest<E>,
  deps: NotifyDeps = defaultDeps,
): Promise<NotifyOutcome> => {
  const recipient = await deps.loadRecipient(request.to).catch((error) => {
    console.error("[notify] failed to load recipient", request.to, error);
    return null;
  });
  if (!recipient) return { delivered: [], failed: [], skipped: "unknown-recipient" };
  if (!recipient.active) return { delivered: [], failed: [], skipped: "inactive-recipient" };

  // Validate with the recipient's real name folded in — the schema is the single source of
  // validation (Definition-of-Done), and it's what guarantees the template's tokens resolve.
  const parsed = parseWith(notificationInputSchema, {
    event: request.event,
    params: { ...request.params, name: recipient.name },
  });
  if (!parsed.ok) {
    console.error("[notify] invalid params for event", request.event, parsed.error.details);
    return { delivered: [], failed: [], skipped: "invalid-params" };
  }
  const input = parsed.value;

  const delivered: NotificationChannel[] = [];
  const failed: NotificationChannel[] = [];
  for (const channel of channelsFor(recipient.kind)) {
    try {
      await (channel === "in_app"
        ? deps.writeInApp(recipient, input)
        : deps.sendEmail(recipient, input));
      delivered.push(channel);
    } catch (error) {
      // Swallow-and-log: the state change this reports has already committed.
      console.error("[notify] delivery failed", channel, request.event, recipient.userId, error);
      failed.push(channel);
    }
  }
  return { delivered, failed };
};
