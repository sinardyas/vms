/**
 * Role-grant eligibility — role administration is an internal-user surface (#96, ADR-0011/0012).
 *
 * The invariant behind `access.error.vendorRoleGrant`: a `user_roles` row is what M1.1's
 * `loadPermissions` expands into an {@link Actor}'s {@link PermissionSet}, and every console module
 * downstream of that (`approvals`, `access`, `audit`…) assumes an **internal** principal. A vendor-kind
 * user is scoped by `requireVendorOwnership` on the vendor routes; handing it a staff role would give
 * it authority those routes never anticipated. `loadPermissions` deliberately does not filter by kind —
 * it expands whatever grants exist — so the kind rule has to hold at the point of **granting**.
 *
 * Pure and DB-free, in the shape of {@link approverIneligibility}: the caller reads the subject's kind
 * from persistence, this decides. The console's role picker filters to internal users as UX; this is the
 * rule that makes that filter a *refusal* rather than a hidden affordance (M0.4's seam premise).
 *
 * **A vendor user's roles are not administered by hand, and that is the whole rule.** Vendor-kind users
 * do legitimately hold the `vendor` role — without it a vendor owner authenticates and is then 403'd by
 * every portal call — but that grant is owned by the registration/invite lifecycle (`office-account.ts`,
 * self-signup), which writes it directly. So the rule refuses *any* hand-administered role patch naming a
 * vendor subject, and the refusal is deliberately **symmetric**: clearing a vendor user's roles would
 * strip that load-bearing `vendor` role and brick the account, so a revocation is no safer than a grant.
 */

import type { UserKind } from "../values/enums";

/** A user as the *subject* of a role grant — only its kind bears on the rule. */
export type GrantSubject = {
  readonly kind: UserKind;
};

/** Why a grant is refused. `null` from {@link roleGrantRefusal} = the grant may proceed. */
export type GrantRefusalReason = "vendor-subject";

/**
 * Why `subject`'s roles may not be set by hand, or `null` if they may. Refuses any vendor-kind
 * subject — grant *or* revocation, see the module note; internal subjects always pass.
 */
export const roleGrantRefusal = (subject: GrantSubject): GrantRefusalReason | null =>
  subject.kind === "vendor" ? "vendor-subject" : null;

/** Whether `subject`'s roles may be set by hand — the boolean form of {@link roleGrantRefusal}. */
export const mayGrantRoles = (subject: GrantSubject): boolean => roleGrantRefusal(subject) === null;
