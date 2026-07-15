/**
 * RBAC guard middleware (M0.4, ADR-0011/0012) — the server-side half of the permission seam.
 *
 * `requirePermission(module, verb)` gates a route: no actor → 401 (`unauthorized`); an actor without
 * the grant → 403 (`forbidden`); otherwise the request proceeds. It evaluates the same `can()` the UI
 * uses for its capability flags, so the button a user can't see is also the request the server refuses.
 *
 * The *decision* is settled here and now; the *data* (which roles grant what) arrives in M1, when the
 * context middleware's actor resolver starts loading `role_permissions`. Until then every actor is
 * `null`, so guarded routes answer 401 — the path is exercised, enforcement fills in behind it.
 */

import {
  type RbacModule,
  type RbacVerb,
  can,
  forbiddenError,
  unauthorizedError,
} from "@vms/domain";
import type { MiddlewareHandler } from "hono";
import type { AppEnv } from "./context";
import { sendError } from "./http-error";

/** Require `(module, verb)` on the request's actor. 401 if unauthenticated, 403 if not permitted. */
export const requirePermission =
  (module: RbacModule, verb: RbacVerb): MiddlewareHandler<AppEnv> =>
  async (c, next) => {
    const { actor } = c.var.ctx;
    if (actor === null) return sendError(c, unauthorizedError());
    if (!can(actor, module, verb)) {
      return sendError(c, forbiddenError({ params: { module, verb } }));
    }
    await next();
  };
