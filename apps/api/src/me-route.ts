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

import { type Actor, capabilities, unauthorizedError } from "@vms/domain";
import { Hono } from "hono";
import type { AppEnv } from "./context";
import { sendError } from "./http-error";

/** The identity fields the client needs — never the raw permission set (it reads flags instead). */
export type MeIdentity = Pick<Actor, "userId" | "kind" | "email" | "name">;

/**
 * Build the `/me` router. Mount under a parent running the request-context middleware, so `c.var.ctx`
 * is populated before the handler reads the actor. Factory (not an inline handler) so a test can mount
 * it with an injected actor resolver, exactly like the walking-skeleton route.
 */
export const meRoutes = () => {
  const app = new Hono<AppEnv>();

  app.get("/me", (c) => {
    const { actor } = c.var.ctx;
    if (actor === null) return sendError(c, unauthorizedError());

    const identity: MeIdentity = {
      userId: actor.userId,
      kind: actor.kind,
      email: actor.email,
      name: actor.name,
    };
    return c.json({ actor: identity, capabilities: capabilities(actor.permissions) });
  });

  return app;
};
