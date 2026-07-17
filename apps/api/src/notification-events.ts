/**
 * Event wiring (M6.2, #78, ADR-0012) — the Phase-0 call sites that actually fire notifications.
 *
 * M6.1 (#77) built the service: a catalogue, a channel policy, templates, and `notify()`. It fired
 * nothing. This module is the other half — the glue each real event needs before it can call
 * `notify()`, kept here rather than in the routes so the five sites share one answer to the three
 * questions every one of them asks:
 *
 * 1. **Who is the recipient?** `notify()` addresses a `users.id`, but the events are *about* vendors.
 *    A vendor's user is its `vendor_sub_users` owner, and until now nothing looked that up in this
 *    direction — `vendor-access.ts` maps user → vendor (for request scoping), never vendor → user.
 *
 * 2. **Which language does a label go in?** Templates take `documentName`/`roleName` as *already
 *    localized strings* (the caller resolves them; see `templates.ts`). But "localized" means *in the
 *    recipient's locale*, which is `users.locale` — not `ctx.locale`, the actor's. So a caller has to
 *    know the recipient's locale *before* it builds the params it hands `notify()`. Hence
 *    {@link vendorOwnerRecipient} returns the locale alongside the id, and the resolution happens here.
 *
 * 3. **When may it fire?** After the state change has committed — never inside its transaction. Email
 *    cannot be un-sent, so a notification riding a transaction that later rolls back is a lie already
 *    delivered. Every helper here is therefore called *outside* the tx that produced the fact it
 *    reports, and inherits `notify()`'s never-throws contract: a Mailpit outage must not 500 a request
 *    whose work succeeded.
 *
 * Deliberately free of any import of the routers it serves, so wiring it in creates no cycle.
 */

import { type DB, db as defaultDb, users, vendorSubUsers, vendors } from "@vms/db";
import { type Locale, type MessageKey, resolveLabel, translate } from "@vms/domain";
import { and, eq } from "drizzle-orm";
import { notify } from "./notifications";

/** Anything that can run a Drizzle `select` — the ambient `db` or an open transaction. */
type Reader = Pick<DB, "select">;

/** A vendor's owner, and the language they read. Enough to address and render a notification. */
export type VendorRecipient = {
  readonly userId: string;
  readonly locale: Locale;
};

/**
 * The `vendor_sub_users` owner of `vendorId`, with their locale — or `null` when the vendor has none.
 *
 * `null` is an ordinary outcome, not an error: an **office**-registered vendor has no owner until
 * activation provisions one (M3.6 creates no owner link; the office-invite path mints the account),
 * so every caller must be able to say "nobody to tell" without failing the operation that prompted it.
 */
export const vendorOwnerRecipient = async (
  reader: Reader,
  vendorId: string,
): Promise<VendorRecipient | null> => {
  const [row] = await reader
    .select({ userId: users.id, locale: users.locale })
    .from(vendorSubUsers)
    .innerJoin(users, eq(users.id, vendorSubUsers.userId))
    .where(and(eq(vendorSubUsers.vendorId, vendorId), eq(vendorSubUsers.isOwner, true)))
    .limit(1);
  return row ?? null;
};

/**
 * A bilingual master-data label as the **columns** carry it (`name_id` / `name_en`, nullable) — the
 * raw shape a caller reads off a joined row, distinct from `@vms/domain`'s `BilingualLabel` (`{id,
 * en}`, both required) that `resolveLabel` consumes. {@link labelFor} is the bridge.
 */
export type LabelColumns = { readonly nameId: string | null; readonly nameEn: string | null };

/**
 * Render a bilingual label in the recipient's language, falling back to `fallback`'s copy when the
 * label is blank in both. Uses the M2.1 `resolveLabel` rule (active locale → sibling locale → empty),
 * so a notification names a document exactly as the console does — and the fallback then catches what
 * that rule resolves to nothing, because the templates require a non-empty name and a half-filled
 * master row must not become a hole in the copy.
 */
export const labelFor = (
  label: LabelColumns | null,
  locale: Locale,
  fallback: MessageKey,
): string => {
  const resolved = label
    ? resolveLabel({ id: label.nameId ?? "", en: label.nameEn ?? "" }, locale)
    : "";
  return resolved || translate(fallback, locale);
};

// --- The events -----------------------------------------------------------------------------------

/** An approval decision on a vendor's own standing, as the vendor needs to hear it. */
export type DecisionNotice = {
  readonly vendorId: string;
  readonly vendorName: string;
  readonly outcome: "approved" | "rejected";
  /** Registration, or a reactivation of a dormant vendor (M6.4) — selects the register (M6.5e). */
  readonly kind: "registration" | "reactivation";
  /** The decider's reason. Required by the template on a rejection (ADR-0012 reject-with-reasons). */
  readonly reason: string | null;
  readonly url: string;
};

/**
 * Tell a vendor's owner that their registration or reactivation was approved or rejected.
 *
 * Only the triggers that move the vendor's **own** lifecycle reach here — a post-activation **edit**
 * (M4.5) is decided by staff on the vendor's behalf and leaves the record Active throughout, so the
 * caller filters on the trigger rather than this function second-guessing it. A **reactivation** does
 * move it, and passes `kind` to say so: M6.4 suppressed this notice entirely rather than send
 * registration copy to a dormant vendor, which left a vendor told *nothing* when their reactivation
 * resolved — including when it put them back in service (M6.5e).
 */
export const notifyDecision = async (reader: Reader, notice: DecisionNotice): Promise<void> => {
  const recipient = await vendorOwnerRecipient(reader, notice.vendorId);
  // No owner ⇒ an office vendor whose account isn't provisioned yet. Its approval is announced by
  // `office_invite` instead — which carries the credential link this email couldn't offer anyway.
  if (!recipient) return;
  await notify({
    to: recipient.userId,
    event: "decision",
    params: {
      url: notice.url,
      vendorName: notice.vendorName,
      outcome: notice.outcome,
      kind: notice.kind,
      // The schema requires a reason on a rejection and forbids nothing on an approval; passing
      // `undefined` rather than `null` lets the optional field simply be absent.
      reason: notice.reason ?? undefined,
    },
  });
};

/** A compliance document a verifier turned down, as the vendor needs to hear it. */
export type DocRejectedNotice = {
  readonly vendorId: string;
  readonly vendorName: string;
  readonly documentLabel: LabelColumns | null;
  readonly reason: string;
  /** Whether rejecting it bounced the registration to Draft — true only for a mandatory doc (M5.3). */
  readonly returnedToDraft: boolean;
  readonly url: string;
};

/**
 * Tell a vendor's owner a document was rejected.
 *
 * Fires for **every** rejection, not just the mandatory ones that bounce the registration. M5.3's
 * seam only fired on the bounce because a bounce was the only thing it had to report; M6.1 then wrote
 * two templates — one saying the registration went back to Draft, one saying it didn't — and the
 * optional branch is unreachable unless this fires on optional rejections too. A vendor whose
 * document was thrown out is owed the reason either way.
 */
export const notifyDocRejected = async (
  reader: Reader,
  notice: DocRejectedNotice,
): Promise<void> => {
  const recipient = await vendorOwnerRecipient(reader, notice.vendorId);
  if (!recipient) return;
  await notify({
    to: recipient.userId,
    event: "doc_rejected",
    params: {
      url: notice.url,
      vendorName: notice.vendorName,
      documentName: labelFor(notice.documentLabel, recipient.locale, "notify.fallback.document"),
      reason: notice.reason,
      returnedToDraft: notice.returnedToDraft,
    },
  });
};

/** An approval step that just opened and was auto-assigned to a decider. */
export type StepAssignedNotice = {
  /** The role lead the step landed on. `null` when the role has no lead — nobody to tell. */
  readonly assigneeUserId: string | null;
  readonly vendorName: string;
  readonly roleLabel: LabelColumns | null;
  readonly url: string;
};

/**
 * Tell an approver a step was assigned to them (ADR-0012 auto-dispatch to the role's lead).
 *
 * `assigneeUserId === null` is expected, not exceptional: a role with no configured lead leaves the
 * step unassigned, to be picked up from the M4.6 Role Queue. There is no one person to notify, so
 * this quietly does nothing rather than inventing a recipient.
 *
 * Scoped to *auto*-assignment. A manual reassign (M4.6 delegate) is a human handing work to a named
 * colleague they chose — the catalogue's `step_assigned` is about the automatic dispatch, and the
 * delegator telling someone directly is not this system's job.
 */
export const notifyStepAssigned = async (
  reader: Reader,
  notice: StepAssignedNotice,
): Promise<void> => {
  if (!notice.assigneeUserId) return;
  // The approver is an internal user; their locale governs the role name, exactly as with documents.
  const [row] = await reader
    .select({ locale: users.locale })
    .from(users)
    .where(eq(users.id, notice.assigneeUserId))
    .limit(1);
  if (!row) return;
  await notify({
    to: notice.assigneeUserId,
    event: "step_assigned",
    params: {
      url: notice.url,
      vendorName: notice.vendorName,
      roleName: labelFor(notice.roleLabel, row.locale, "notify.fallback.role"),
    },
  });
};

/**
 * The vendor a freshly provisioned office account belongs to — everything the invite email needs,
 * read back after activation so the copy names the real record.
 */
export const vendorNameFor = async (reader: Reader, vendorId: string): Promise<string | null> => {
  const [row] = await reader
    .select({ name: vendors.name })
    .from(vendors)
    .where(eq(vendors.id, vendorId))
    .limit(1);
  return row?.name ?? null;
};

/** The ambient-`db` reader, for callers firing after their own transaction has committed. */
export const notificationReader = (): Reader => defaultDb;
