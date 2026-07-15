/**
 * Session-backed actor resolver (M1.1, #20) — the real {@link ActorResolver} that replaces the
 * walking-skeleton dev stand-in (`./dev-actor`).
 *
 * For each request it validates the better-auth session, then loads the acting principal from our
 * own `users` table (authoritative for `kind` and the `active` flag) and expands the user's role
 * grants into a {@link PermissionSet}. A request with no valid session — or one whose user has been
 * deactivated — resolves to `null`, so the RBAC guard answers 401 and `can()` denies by default.
 *
 * The permission *data* is seeded in M1.2 (#21): until roles are granted, a valid session still
 * resolves an actor, but with an empty permission set (deny-all). M1.3 (#22) is where guarded
 * feature routes meet real grants. This module supplies the mechanism, not the data.
 */

import { type DB, users } from "@vms/db";
import type { Actor } from "@vms/domain";
import { eq } from "drizzle-orm";
import { auth } from "./auth";
import type { ActorResolver } from "./context";
import { loadPermissions } from "./permissions";

/**
 * Build the resolver bound to a database handle. Reads the better-auth session off the raw request
 * headers, then joins identity + grants into the domain {@link Actor}.
 */
export const sessionActorResolver =
  (database: DB): ActorResolver =>
  async (c): Promise<Actor | null> => {
    const session = await auth.api.getSession({ headers: c.req.raw.headers });
    const userId = session?.user?.id;
    if (!userId) return null;

    // Load from our table, not the session payload: `active` isn't a better-auth field, and this
    // keeps kind/email/name authoritative to the source of truth (a mid-session deactivation denies).
    const [row] = await database
      .select({
        kind: users.kind,
        email: users.email,
        name: users.name,
        active: users.active,
      })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    if (!row || !row.active) return null;

    return {
      userId,
      kind: row.kind,
      email: row.email,
      name: row.name,
      permissions: await loadPermissions(database, userId),
    };
  };
