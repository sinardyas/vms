/**
 * Session identity + capability mirror (M1.3, #22, ADR-0011).
 *
 * `GET /me` is the server-authored source the UI mirrors: it returns the acting principal's identity
 * and its full 9×5 {@link CapabilityFlags} grid, computed from the *same* {@link Actor} permission set
 * the RBAC guard (`requirePermission`) evaluates. So a button the UI hides for want of a capability is
 * exactly the request a guarded route would refuse — the two can't drift, because they read one grid.
 *
 * Deny-by-default all the way down: no session → 401 (the same signal a guarded route gives an
 * anonymous caller), so the UI treats "not signed in" as "everything denied". Any *authenticated*
 * actor may read its own capabilities — no permission is required to ask "what may I do?".
 *
 * There are no feature mutations to guard yet (those land in M2/M3); this closes M1.3 by making the
 * enforcement seam observable from the client, so every screen built later gates on the live grid.
 */

import {
  type SessionIdentity,
  type SessionRole,
  capabilities,
  unauthorizedError,
} from "@vms/domain";
import { Hono } from "hono";
import type { AppEnv } from "./context";
import { sendError } from "./http-error";

/** Resolves the display roles a user holds. Injected so the route is testable without a database. */
export type RoleLoader = (userId: string) => Promise<readonly SessionRole[]>;

/**
 * Build the `/me` router. Mount under a parent running the request-context middleware, so `c.var.ctx`
 * is populated before the handler reads the actor. Factory (not an inline handler) so a test can mount
 * it with an injected actor resolver, exactly like the walking-skeleton route.
 *
 * `loadRoles` is a second read rather than a field on {@link Actor}: roles are needed only to *show*
 * who is signed in (M6.5, #90), so every other request — which authorizes off the permission set —
 * shouldn't pay for the join.
 */
export const meRoutes = (loadRoles: RoleLoader) => {
  const app = new Hono<AppEnv>();

  app.get("/me", async (c) => {
    const { actor } = c.var.ctx;
    if (actor === null) return sendError(c, unauthorizedError());

    const identity: SessionIdentity = {
      userId: actor.userId,
      kind: actor.kind,
      email: actor.email,
      name: actor.name,
      roles: await loadRoles(actor.userId),
    };
    return c.json({ actor: identity, capabilities: capabilities(actor.permissions) });
  });

  return app;
};
