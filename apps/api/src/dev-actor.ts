/**
 * Walking-skeleton actor resolver (#8) — a DEV-ONLY stand-in for M1 authentication.
 *
 * The M0.4 context middleware exposes a pluggable {@link ActorResolver} whose default resolves
 * "nobody" until better-auth lands in M1. To prove the *authenticated* spine end-to-end before any
 * auth exists — check a permission → write an audit row → read the DB → render — the walking skeleton
 * injects this fixed internal actor, granted every module×verb so any guarded route can be exercised.
 *
 * It is enabled ONLY when `env.devActor` is true, which requires `DEV_ACTOR=1` **and** a non-production
 * `NODE_ENV` (see {@link env}). The staging overlay pins `NODE_ENV=production` and never sets `DEV_ACTOR`,
 * so this can never resolve a fake principal in staging/prod — there the default "nobody" resolver stands
 * and guarded routes answer 401 until M1 wires the session-backed resolver in its place.
 */

import { type DB, users } from "@vms/db";
import {
  type Actor,
  type PermissionSet,
  RBAC_MODULES,
  RBAC_VERBS,
  toPermissionSet,
} from "@vms/domain";
import type { ActorResolver } from "./context";

/** Every grant, so the skeleton's guarded routes all pass. M1's real actors carry a scoped subset. */
const ALL_PERMISSIONS: PermissionSet = toPermissionSet(
  RBAC_MODULES.flatMap((module) => RBAC_VERBS.map((verb) => ({ module, verb }))),
);

/** Fixed, obviously-fake (but valid-hex) id so the backing `users` row is stable and idempotent. */
const DEV_ACTOR_ID = "deadbeef-0000-4000-8000-00000000d001";

/** The stand-in principal the walking skeleton acts as (dev only). */
export const DEV_ACTOR: Actor = {
  userId: DEV_ACTOR_ID,
  kind: "internal",
  email: "dev@soechi.id",
  name: "Walking Skeleton",
  permissions: ALL_PERMISSIONS,
};

/** Resolver that always returns {@link DEV_ACTOR}. Wired only when `env.devActor` is true. */
export const devActorResolver: ActorResolver = () => DEV_ACTOR;

/**
 * Ensure the `users` row backing {@link DEV_ACTOR} exists, so an audit row attributed to it satisfies
 * the `audit_log.actor_user_id → users.id` foreign key. Idempotent (`on conflict do nothing`), so it is
 * safe to call on every request; a real login flow (M1) makes this obsolete.
 */
export const ensureDevActorUser = async (db: DB): Promise<void> => {
  await db
    .insert(users)
    .values({
      id: DEV_ACTOR.userId,
      kind: DEV_ACTOR.kind,
      email: DEV_ACTOR.email,
      name: DEV_ACTOR.name,
      emailVerified: true,
    })
    .onConflictDoNothing();
};
