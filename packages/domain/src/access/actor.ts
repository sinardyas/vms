/**
 * Request context, actor identity, and the `can()` seam (M0.4, ADR-0011, 0012).
 *
 * The stack-neutral shape the API builds at the edge and threads into the domain: who is acting
 * (or `null` for an unauthenticated / system request), in which locale, and from where (ip / user
 * agent, for the audit trail). Every domain mutation from M3 on takes a {@link RequestContext};
 * the audit writer reads actor + ip + ua off it, and the RBAC guard reads the actor's permissions.
 *
 * `can()` is deny-by-default: a `null` actor (unauthenticated) or an unresolved / empty permission
 * set both mean "no". M1 populates {@link Actor.permissions} from `role_permissions`; the shape and
 * the check are settled here so every later mutation inherits RBAC by construction.
 */

import type { RbacModule, RbacVerb, UserKind } from "../values/enums";
import type { Locale } from "../values/locale";
import { type PermissionSet, permissionKey } from "./rbac";

/** An authenticated principal — identity plus its resolved RBAC grants. */
export type Actor = {
  readonly userId: string;
  readonly kind: UserKind;
  readonly email: string;
  readonly name: string;
  /** Resolved grants for this actor. M1 loads these from `role_permissions`; empty = deny all. */
  readonly permissions: PermissionSet;
};

/**
 * A role the signed-in user holds, as the UI needs to *show* it (M6.5, #90).
 *
 * `code` is the language-neutral business key (ADR-0011) — match on this, never on a display name.
 * `nameId`/`nameEn` are the role's own bilingual labels from the `roles` table, so a role added by an
 * admin at runtime names itself; they are deliberately not i18n catalogue keys, which are fixed at
 * build time and could not cover rows that don't exist yet.
 */
export type SessionRole = {
  readonly code: string;
  readonly nameId: string;
  readonly nameEn: string;
};

/**
 * Who the client may say is signed in — the identity half of `GET /me`, mirrored by the UI's
 * capability provider (M1.3, #22; widened in M6.5, #90).
 *
 * Never carries {@link Actor.permissions}: the client reads the derived {@link CapabilityFlags} grid
 * instead, so it can only ask "may I?" — not enumerate the raw grant set. `roles` is for display
 * (the console header names the signed-in staff member and their role); authorization decisions read
 * the grid, never this list.
 */
export type SessionIdentity = Pick<Actor, "userId" | "kind" | "email" | "name"> & {
  readonly roles: readonly SessionRole[];
};

/**
 * Everything a request carries into the domain. `actor` is `null` for an unauthenticated caller
 * or a system-initiated action (both audit as a null actor — no `userId`). `ip` / `userAgent` are
 * captured for the audit log and may be absent behind some proxies.
 */
export type RequestContext = {
  readonly actor: Actor | null;
  readonly locale: Locale;
  readonly ip?: string;
  readonly userAgent?: string;
};

/**
 * The RBAC decision — `can(actor, module, verb)` (ADR-0011/0012). Deny-by-default: `false` unless
 * an authenticated actor's permission set explicitly grants the `(module, verb)` pair.
 */
export const can = (actor: Actor | null, module: RbacModule, verb: RbacVerb): boolean =>
  actor?.permissions.has(permissionKey(module, verb)) ?? false;
