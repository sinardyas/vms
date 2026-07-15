/**
 * Audit viewer (M1.4, #23, ADR-0011) — `GET /console/audit`, the real search/filter over `audit_log`.
 *
 * Generalizes the walking-skeleton read (#8, M0.6) into the module proper: a guarded (`audit:view`),
 * read-only, paginated query with filters on **actor** (name/email), **action**, **module**,
 * **subject** (type + id), and a **date range** (`from`/`to` over `at`). It joins `users` so each row
 * carries the actor's name/email — the log spans many actors now, not just the caller.
 *
 * It is a read, not a mutation, so — unlike the walking skeleton, which logged its own view to have a
 * row to read back — it writes nothing. The trail's content comes from actual mutations: the auth
 * events (M1.4, see `auth.ts`) today, every feature mutation (M2+) as they land.
 *
 * Data access is behind {@link AuditStore} so the route's filter → query → shape orchestration is
 * unit-testable without Postgres; the default store is the real Drizzle-backed implementation.
 */

import { type DB, auditLog, db as defaultDb, users } from "@vms/db";
import { rbacModuleSchema, validationError } from "@vms/domain";
import { and, count, desc, eq, gte, ilike, lte, or } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "./context";
import { sendError } from "./http-error";
import { requirePermission } from "./rbac";

/** One audit row as sent to the client — dates serialised, actor resolved to a human name/email. */
export type AuditRowDTO = {
  readonly id: string;
  readonly at: string;
  readonly actorUserId: string | null;
  readonly actorName: string | null;
  readonly actorEmail: string | null;
  readonly action: string;
  readonly module: string | null;
  readonly subjectType: string;
  readonly subjectId: string | null;
  readonly ip: string | null;
};

/** How many rows a page holds by default, and the ceiling a client may request. */
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

/**
 * The parsed, validated query — free-text filters plus a page window. `from`/`to` are `Date`s (bounds
 * on `at`); the free-text fields match case-insensitively (`actor` against the user's name **or**
 * email, `action`/`subjectType` as substrings), and `module`/`subjectId` match exactly.
 */
const auditQuerySchema = z.object({
  actor: z.string().trim().min(1).optional(),
  action: z.string().trim().min(1).optional(),
  module: rbacModuleSchema.optional(),
  subjectType: z.string().trim().min(1).optional(),
  subjectId: z.string().uuid().optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  limit: z.coerce.number().int().min(1).max(MAX_LIMIT).default(DEFAULT_LIMIT),
  offset: z.coerce.number().int().min(0).default(0),
});

export type AuditQuery = z.infer<typeof auditQuerySchema>;

/** A page of results: the rows for the requested window plus the total matching the filters. */
export type AuditPage = { readonly rows: AuditRowDTO[]; readonly total: number };

/** The route's data-access seam: run the filtered, paginated read. */
export type AuditStore = {
  readonly query: (q: AuditQuery) => Promise<AuditPage>;
};

/** The real store — reads `audit_log` (joined to `users` for actor identity) through Drizzle. */
export const drizzleAuditStore = (db: DB = defaultDb): AuditStore => ({
  query: async (q) => {
    // Build the filter set — each present filter narrows the match; absent ones don't constrain.
    const conditions = [
      q.actor
        ? or(ilike(users.name, `%${q.actor}%`), ilike(users.email, `%${q.actor}%`))
        : undefined,
      q.action ? ilike(auditLog.action, `%${q.action}%`) : undefined,
      q.module ? eq(auditLog.module, q.module) : undefined,
      q.subjectType ? ilike(auditLog.subjectType, `%${q.subjectType}%`) : undefined,
      q.subjectId ? eq(auditLog.subjectId, q.subjectId) : undefined,
      q.from ? gte(auditLog.at, q.from) : undefined,
      q.to ? lte(auditLog.at, q.to) : undefined,
    ].filter((c): c is NonNullable<typeof c> => c !== undefined);
    const where = conditions.length > 0 ? and(...conditions) : undefined;

    // Left join: a system/unauthenticated row has a null actor and still belongs in the trail.
    const rows = await db
      .select({
        id: auditLog.id,
        at: auditLog.at,
        actorUserId: auditLog.actorUserId,
        actorName: users.name,
        actorEmail: users.email,
        action: auditLog.action,
        module: auditLog.module,
        subjectType: auditLog.subjectType,
        subjectId: auditLog.subjectId,
        ip: auditLog.ip,
      })
      .from(auditLog)
      .leftJoin(users, eq(users.id, auditLog.actorUserId))
      .where(where)
      // `id` breaks ties so paging is stable when rows share a timestamp (append-only, high write rate).
      .orderBy(desc(auditLog.at), desc(auditLog.id))
      .limit(q.limit)
      .offset(q.offset);

    const [{ total }] = await db
      .select({ total: count() })
      .from(auditLog)
      .leftJoin(users, eq(users.id, auditLog.actorUserId))
      .where(where);

    return {
      rows: rows.map((r) => ({ ...r, at: r.at.toISOString() })),
      total: total ?? 0,
    };
  },
});

/** Non-empty query params only — a cleared filter input sends `""`, which must not become a filter. */
const presentParams = (c: { req: { query: () => Record<string, string> } }): Record<
  string,
  string
> => Object.fromEntries(Object.entries(c.req.query()).filter(([, v]) => v.trim() !== ""));

/**
 * Build the `/audit` router. Mount under a parent that runs the request-context middleware, so
 * `c.var.ctx` is populated before the guard reads the actor. Pass a fake store in tests.
 */
export const auditRoutes = (store: AuditStore = drizzleAuditStore()) => {
  const app = new Hono<AppEnv>();

  app.get("/audit", requirePermission("audit", "view"), async (c) => {
    const parsed = auditQuerySchema.safeParse(presentParams(c));
    if (!parsed.success) return sendError(c, validationError({ details: parsed.error.issues }));

    const { limit, offset } = parsed.data;
    const page = await store.query(parsed.data);

    return c.json({ rows: page.rows, total: page.total, limit, offset });
  });

  return app;
};
