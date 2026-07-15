/**
 * Walking-skeleton route (#8, M0.6) — the one authenticated slice that proves the whole stack.
 *
 * `GET /console/audit` threads every layer the ticket names, in order:
 *   RBAC guard (`audit:view`)  →  write an audit row  →  read the audit log back  →  JSON for React.
 *
 * It is deliberately self-contained: the row it writes is a row it reads, so the slice demonstrates a
 * live DB round-trip with no seed data. The guard, the audit writer, and the request context are the
 * real M0.4 primitives (#7); only the acting principal is a dev stand-in until M1 (see `dev-actor.ts`).
 *
 * Data access is behind {@link AuditStore} so the route's orchestration is unit-testable without
 * Postgres; the default store is the real Drizzle-backed implementation used in the running app.
 */

import { type DB, auditLog, db as defaultDb } from "@vms/db";
import type { RequestContext } from "@vms/domain";
import { desc } from "drizzle-orm";
import { Hono } from "hono";
import { type AuditEntry, writeAudit } from "./audit";
import type { AppEnv } from "./context";
import { ensureDevActorUser } from "./dev-actor";
import { env } from "./env";
import { requirePermission } from "./rbac";

/** One audit row as sent to the client — dates serialised, nothing the UI can't render. */
export type AuditRowDTO = {
  readonly id: string;
  readonly at: string;
  readonly actorUserId: string | null;
  readonly action: string;
  readonly module: string | null;
  readonly subjectType: string;
  readonly subjectId: string | null;
  readonly ip: string | null;
};

/** The route's data-access seam: satisfy the actor FK, append a row, read recent rows. */
export type AuditStore = {
  readonly ensureActor: () => Promise<void>;
  readonly record: (ctx: RequestContext, entry: AuditEntry) => Promise<void>;
  readonly recent: (limit: number) => Promise<AuditRowDTO[]>;
};

/** The real store — writes/reads `audit_log` through the shared Drizzle client. */
export const drizzleAuditStore = (db: DB = defaultDb): AuditStore => ({
  // Only needed while the dev actor stands in for real auth; a no-op otherwise.
  ensureActor: () => (env.devActor ? ensureDevActorUser(db) : Promise.resolve()),
  record: (ctx, entry) => writeAudit(db, ctx, entry),
  recent: async (limit) => {
    const rows = await db
      .select({
        id: auditLog.id,
        at: auditLog.at,
        actorUserId: auditLog.actorUserId,
        action: auditLog.action,
        module: auditLog.module,
        subjectType: auditLog.subjectType,
        subjectId: auditLog.subjectId,
        ip: auditLog.ip,
      })
      .from(auditLog)
      .orderBy(desc(auditLog.at))
      .limit(limit);
    return rows.map((r) => ({ ...r, at: r.at.toISOString() }));
  },
});

/** How many recent actions the walking-skeleton screen shows. */
const RECENT_LIMIT = 50;

/**
 * Build the `/audit` router. Mount under a parent that runs the request-context middleware, so
 * `c.var.ctx` is populated before the guard and handler read it. Pass a fake store in tests.
 */
export const auditRoutes = (store: AuditStore = drizzleAuditStore()) => {
  const app = new Hono<AppEnv>();

  app.get("/audit", requirePermission("audit", "view"), async (c) => {
    const ctx = c.var.ctx;

    // Make the acting principal real enough for the FK (dev only), then log this very view…
    await store.ensureActor();
    await store.record(ctx, { action: "audit.viewed", module: "audit", subjectType: "audit_log" });

    // …and read the trail back — the row just written is included, proving the round-trip.
    const rows = await store.recent(RECENT_LIMIT);

    return c.json({
      actor: ctx.actor ? { name: ctx.actor.name, email: ctx.actor.email } : null,
      locale: ctx.locale,
      rows,
    });
  });

  return app;
};
