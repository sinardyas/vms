/**
 * Office-vendor account provisioning (M6.2, #78, ADR-0004) — giving an office-registered vendor an
 * owner at the moment its registration is activated.
 *
 * **Why this exists.** A vendor registered by staff on the vendor's behalf (M3.6) has no user: the
 * staff member owns nothing, and the vendor was never at a keyboard, so `vendor_sub_users` gets no
 * owner row (deliberately — the office flow has no one to link). That's fine while the registration
 * is under review. It stops being fine the instant it's activated: the vendor is now a live
 * counterparty who must be able to sign in, see their record, and maintain it. Someone has to be
 * handed the keys, and this is the only moment we know they've earned them.
 *
 * `office_invite` is what M6.1 called that hand-off, and its copy already promises a link to "set a
 * password" — which presupposes an account to set one *on*. So provisioning isn't an extra this
 * ticket invented; it's the precondition the invite was written against.
 *
 * **Who.** The vendor's PIC (`pic_email` / `pic_name`), falling back to the company address
 * (`vendors.email`). A vendor with neither is un-invitable — see {@link ProvisionOutcome}.
 *
 * **How the credential travels.** Nothing here sets or stores a password. The account is created
 * without one, exactly as M1.5's internal-user create does (#24), and the owner establishes their own
 * via a password-set link — so a temporary secret never exists to be intercepted, logged, or reused.
 * Sending that link is `auth.ts`'s job (better-auth mints the token); this module only makes the
 * account it will belong to.
 *
 * **Transactionality.** `provisionOfficeOwner` takes an open `tx` and runs inside the decide
 * transaction that activates the vendor, so the vendor can never end up Active-but-unclaimable: if
 * activation rolls back, so does the account. The *email* is the opposite — it's sent after the
 * commit, because it can't be unsent.
 */

import { type DB, roles, userRoles, users, vendorSubUsers, vendors } from "@vms/db";
import type { Locale } from "@vms/domain";
import { and, eq } from "drizzle-orm";

/** An open Drizzle transaction handle (cf. `approval-engine.ts`). */
type Tx = Parameters<Parameters<DB["transaction"]>[0]>[0];

/**
 * What provisioning did.
 *
 * `no-contact` is the honest failure: an office vendor captured with neither a PIC nor a company
 * email has nobody to invite. It must not fail the activation — the approval decision is legitimate
 * and the record is correct; staff can add the contact and re-invite later. So it's reported, not
 * thrown, and the caller logs it.
 */
export type ProvisionOutcome =
  | { readonly status: "provisioned"; readonly email: string }
  /** The vendor already had an owner (e.g. a re-activation) — nothing to mint, nothing to invite. */
  | { readonly status: "exists" }
  | { readonly status: "no-contact" };

/** The invite address: the named contact first, the company inbox as a fallback. */
const contactFor = (vendor: {
  picEmail: string | null;
  email: string | null;
}): string | null => vendor.picEmail?.trim() || vendor.email?.trim() || null;

/**
 * Give the office-registered vendor `vendorId` an owner account, inside `tx`.
 *
 * Idempotent on two axes, because both can legitimately already be true: the vendor may already have
 * an owner (a re-activation), and the contact's email may already have a user (one person is the PIC
 * for two vendors, or they self-registered earlier). In the second case the existing user is
 * **linked** rather than duplicated — `users.email` is unique, so inserting would throw and strand a
 * valid activation over an account that already exists and works.
 */
export const provisionOfficeOwner = async (
  tx: Tx,
  vendorId: string,
  locale: Locale,
): Promise<ProvisionOutcome> => {
  const [existingOwner] = await tx
    .select({ id: vendorSubUsers.id })
    .from(vendorSubUsers)
    .where(and(eq(vendorSubUsers.vendorId, vendorId), eq(vendorSubUsers.isOwner, true)))
    .limit(1);
  if (existingOwner) return { status: "exists" };

  const [vendor] = await tx
    .select({
      name: vendors.name,
      email: vendors.email,
      picEmail: vendors.picEmail,
      picName: vendors.picName,
    })
    .from(vendors)
    .where(eq(vendors.id, vendorId))
    .limit(1);
  if (!vendor) return { status: "no-contact" };
  const email = contactFor(vendor);
  if (!email) return { status: "no-contact" };

  // Reuse the account if this address already has one; otherwise mint a passwordless vendor user.
  const [existingUser] = await tx
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, email))
    .limit(1);
  let userId = existingUser?.id;
  if (!userId) {
    const [created] = await tx
      .insert(users)
      .values({
        kind: "vendor",
        email,
        name: vendor.picName?.trim() || vendor.name,
        // The invite link *is* the proof of address — following it demonstrates control of the
        // inbox, exactly as the self-signup verify link does. Marking it verified here would assert
        // something we haven't yet observed, so it stays false until they act on the invite.
        emailVerified: false,
        locale,
      })
      .returning({ id: users.id });
    if (!created) throw new Error("office owner insert returned no row");
    userId = created.id;
  }

  await tx.insert(vendorSubUsers).values({ vendorId, userId, isOwner: true }).onConflictDoNothing();

  // Without the `vendor` role the new owner authenticates fine and is then 403'd by every portal
  // call — an account that exists but can do nothing (the same trap M3.5 found on self-signup).
  const [vendorRole] = await tx
    .select({ id: roles.id })
    .from(roles)
    .where(eq(roles.code, "vendor"))
    .limit(1);
  if (vendorRole) {
    await tx.insert(userRoles).values({ userId, roleId: vendorRole.id }).onConflictDoNothing();
  } else {
    console.error("[office-invite] vendor role not seeded — owner has no permissions", userId);
  }

  return { status: "provisioned", email };
};
