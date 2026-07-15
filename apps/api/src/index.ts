import { db } from "@vms/db";
import { APP_NAME } from "@vms/domain";
import { sql } from "drizzle-orm";
import { Hono } from "hono";
import { type AppEnv, requestContext } from "./context";
import { env } from "./env";

const app = new Hono<AppEnv>();

// Every request carries a RequestContext (actor, locale, ip/ua) — the M0.4 cross-cutting seam that
// the audit writer and RBAC guard read. Actor resolution is unauthenticated until M1 wires auth.
app.use("*", requestContext());

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

export default { port: env.port, fetch: app.fetch };
