import { db } from "@vms/db";
import { APP_NAME } from "@vms/domain";
import { sql } from "drizzle-orm";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { auditRoutes } from "./audit-route";
import { auth } from "./auth";
import { type AppEnv, requestContext } from "./context";
import { devActorResolver } from "./dev-actor";
import { env } from "./env";
import { meRoutes } from "./me-route";
import { sessionActorResolver } from "./session-actor";

const app = new Hono<AppEnv>();

// The SPAs (console :3002, portal :3000) call this API — including the auth endpoints — from another
// origin. Credentials must be allowed so the better-auth session cookie is sent and set cross-origin.
app.use("*", cors({ origin: env.corsOrigins, credentials: true }));

// better-auth owns everything under its base path (sign-up, verify, sign-in, session, reset). Mounted
// BEFORE the context middleware and terminal (returns a Response), so the per-request session lookup
// below never runs against better-auth's own routes.
app.on(["POST", "GET"], "/api/auth/*", (c) => auth.handler(c.req.raw));

// Every other request carries a RequestContext (actor, locale, ip/ua) — the M0.4 cross-cutting seam
// the audit writer and RBAC guard read. The actor is now resolved from the real better-auth session
// (M1.1); the dev stand-in (#8) remains available only when `DEV_ACTOR` is explicitly on in a
// non-production env, so the walking skeleton still runs without a login.
app.use("*", requestContext(env.devActor ? devActorResolver : sessionActorResolver(db)));

app.get("/", (c) => c.text(`${APP_NAME} API — see /health`));

app.get("/health", (c) =>
  c.json({ ok: true, service: "vms-api", app: APP_NAME, env: env.nodeEnv }),
);

// Proves the @vms/db wiring end-to-end. Requires Postgres up; returns 503 if it can't connect,
// so the process itself boots fine without a database (the walking skeleton, #8, drives this).
app.get("/health/db", async (c) => {
  try {
    await db.execute(sql`select 1`);
    return c.json({ ok: true, db: "up" });
  } catch (error) {
    return c.json({ ok: false, db: "down", error: String(error) }, 503);
  }
});

// M1.3 (#22): the session's identity + capability grid — the server-authored mirror the UI reads to
// show/hide affordances. Computed from the same permission set the RBAC guard evaluates, so a hidden
// button is a refused request. 401 for an anonymous caller (deny-by-default).
app.route("/", meRoutes());

// Walking skeleton (#8, M0.6): guard → audit write → DB read → JSON the console renders in @vms/ui.
app.route("/console", auditRoutes());

export default { port: env.port, fetch: app.fetch };
