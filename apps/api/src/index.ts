import { db } from "@vms/db";
import { APP_NAME } from "@vms/domain";
import { sql } from "drizzle-orm";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { auditRoutes } from "./audit-route";
import { type AppEnv, requestContext } from "./context";
import { devActorResolver } from "./dev-actor";
import { env } from "./env";

const app = new Hono<AppEnv>();

// The SPAs (console :3002, portal :3000) call this API from another origin — allow them explicitly.
app.use("*", cors({ origin: env.corsOrigins }));

// Every request carries a RequestContext (actor, locale, ip/ua) — the M0.4 cross-cutting seam that
// the audit writer and RBAC guard read. Auth arrives in M1; until then the actor is the dev
// stand-in when `DEV_ACTOR` is on (walking skeleton, #8), otherwise "nobody" (guarded routes → 401).
app.use("*", requestContext(env.devActor ? devActorResolver : undefined));

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

// Walking skeleton (#8, M0.6): guard → audit write → DB read → JSON the console renders in @vms/ui.
app.route("/console", auditRoutes());

export default { port: env.port, fetch: app.fetch };
