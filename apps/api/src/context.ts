/**
 * Request-context middleware (M0.4, ADR-0011/0012).
 *
 * The API edge where a raw HTTP request becomes the stack-neutral {@link RequestContext} the domain
 * speaks: it resolves the locale (query → cookie → `Accept-Language`, defaulting to `id`), captures
 * ip / user-agent for the audit trail, and resolves the acting principal. It then stashes the context
 * on `c.var.ctx` so every downstream handler, the audit writer, and the RBAC guard read the same thing.
 *
 * Actor resolution is a **seam**: {@link ActorResolver} defaults to "nobody" (auth arrives in M1 with
 * better-auth). M1 swaps in a session-backed resolver; tests and the walking skeleton (#8) inject a
 * stub. Everything else about the context is real now.
 */

import { type Actor, type RequestContext, resolveLocale } from "@vms/domain";
import type { Context, MiddlewareHandler } from "hono";
import { getCookie } from "hono/cookie";

/** Hono environment: what this app stores on the request context. */
export type AppEnv = { Variables: { ctx: RequestContext } };

/** Resolves the acting principal for a request, or `null` if unauthenticated. Replaced in M1. */
export type ActorResolver = (c: Context<AppEnv>) => Actor | null | Promise<Actor | null>;

/** Default resolver until auth lands: no session store yet, so every request is unauthenticated. */
const noActor: ActorResolver = () => null;

/** First client IP from the proxy chain, or the direct peer where the platform exposes it. */
const clientIp = (c: Context<AppEnv>): string | undefined => {
  const forwarded = c.req.header("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]?.trim();
  return c.req.header("x-real-ip") ?? undefined;
};

/** Pick the requested locale from `?lang`, the `locale` cookie, then `Accept-Language`. */
const requestedLocale = (c: Context<AppEnv>): string | undefined =>
  c.req.query("lang") ??
  getCookie(c, "locale") ??
  c.req.header("accept-language")?.split(",")[0]?.split("-")[0]?.trim();

/**
 * Build the request-context middleware. Pass a real {@link ActorResolver} in M1; omit it to get the
 * unauthenticated default. The middleware always sets `c.var.ctx` before calling downstream handlers.
 */
export const requestContext =
  (resolveActor: ActorResolver = noActor): MiddlewareHandler<AppEnv> =>
  async (c, next) => {
    const actor = await resolveActor(c);
    c.set("ctx", {
      actor,
      locale: resolveLocale(requestedLocale(c)),
      ip: clientIp(c),
      userAgent: c.req.header("user-agent") ?? undefined,
    });
    await next();
  };
