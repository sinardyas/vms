/**
 * Notification centre (M6.3, #79, ADR-0016) — the read half of the notification service.
 *
 * M6.1 writes rows; this reads them back for the surface that displays them: the console bell and the
 * portal bell, both over the same three routes.
 *
 * **Self-scoped, authenticated-only — no RBAC module.** The user id comes from the session, never the
 * request, so the scope is identity rather than permission: a caller reads and marks-read exactly their
 * own rows and there is no parameter that could widen that. This follows `GET /me` (M1.3): "what was I
 * told?" is no more a permission subject than "what may I do?" is, and a tenth RBAC module would ripple
 * through `role_permissions`, the seed, and every role's grid to express a grant that is never
 * legitimately withheld. Anonymous → 401, the same signal a guarded route gives.
 *
 * **Rendering happens here, at read time.** A row stores `titleKey`/`bodyKey`/`params`, never rendered
 * copy (M6.1), so the reader's language is applied now rather than frozen at write. For a self-scoped
 * read the actor *is* the recipient, so `ctx.locale` — the request's language — is the right one: the
 * actor/recipient divergence that forced `users.locale` (a verifier working in English rejecting a
 * document an Indonesian vendor must read about) cannot arise when you're reading your own bell. That
 * also means flipping the locale switch re-renders the same rows in the other language, because the
 * client refetches with `?lang=` and the copy was never baked in.
 */

import { type DB, db as defaultDb, notifications } from "@vms/db";
import {
  type Locale,
  isMessageKey,
  notFoundError,
  translate,
  unauthorizedError,
  validationError,
} from "@vms/domain";
import { and, count, desc, eq, isNull, sql } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "./context";
import { sendError } from "./http-error";

/**
 * One notification as the bell renders it — copy resolved, not keys.
 *
 * The client gets finished strings because the row's keys are `varchar`, not `MessageKey`s: only the
 * server can safely resolve them (see {@link renderRow}), and a client that received raw keys would
 * have to re-implement that guard to say anything at all.
 */
export type NotificationDTO = {
  readonly id: string;
  readonly event: string;
  readonly title: string;
  /** `null` when the row carries no body key, or its key no longer resolves. */
  readonly body: string | null;
  /** Where the CTA points — the row's stored `link`. */
  readonly link: string | null;
  readonly read: boolean;
  readonly createdAt: string;
};

/** A page of the feed, plus the unread total the badge shows. */
export type NotificationFeed = {
  readonly rows: NotificationDTO[];
  /** Unread across the *whole* feed, not just this page — the badge counts everything outstanding. */
  readonly unread: number;
  readonly total: number;
};

/** How many rows a page holds by default, and the ceiling a client may request. */
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

const feedQuerySchema = z.object({
  /** `true` → only unread. The bell's default view is everything, newest first. */
  unreadOnly: z.coerce.boolean().default(false),
  limit: z.coerce.number().int().min(1).max(MAX_LIMIT).default(DEFAULT_LIMIT),
  offset: z.coerce.number().int().min(0).default(0),
});

export type NotificationFeedQuery = z.infer<typeof feedQuerySchema>;

/** The route's data-access seam — every DB touch, so the surface is testable without Postgres. */
export type NotificationStore = {
  /** One user's feed, newest first. */
  readonly feed: (userId: string, q: NotificationFeedQuery) => Promise<NotificationFeed>;
  /**
   * Mark one row read. Scoped by `userId` in the same statement as `id` — so marking another user's
   * notification read isn't a 403 to get right, it simply matches nothing. Returns whether it hit.
   * Idempotent: re-marking an already-read row succeeds without moving `readAt`.
   */
  readonly markRead: (userId: string, id: string) => Promise<boolean>;
  /** Mark every unread row read. Returns how many moved. */
  readonly markAllRead: (userId: string) => Promise<number>;
};

/**
 * Render one stored row into `locale`.
 *
 * Renders from the row's **stored** keys rather than re-deriving them from the event, because the row
 * is the record of what was actually said: `resolveTemplate` branches on params (an approved decision
 * reads nothing like a rejected one), and re-deriving would let a later change to that branching
 * silently rewrite the history of a notification already sent.
 *
 * A key that no longer resolves degrades to a generic line instead of throwing — one stale row from a
 * renamed key must not take out the entire bell (`translate` would throw on it; {@link isMessageKey}
 * is the guard).
 */
const renderRow = (
  row: {
    id: string;
    event: string;
    titleKey: string;
    bodyKey: string | null;
    params: Record<string, unknown> | null;
    link: string | null;
    readAt: Date | null;
    createdAt: Date;
  },
  locale: Locale,
): NotificationDTO => {
  // The params were Zod-validated at write time (M6.1) against the event's schema; booleans in there
  // select a template rather than appear in copy, so the cast is to the token bag `translate` reads.
  const params = (row.params ?? {}) as Readonly<Record<string, string | number>>;
  return {
    id: row.id,
    event: row.event,
    title: isMessageKey(row.titleKey)
      ? translate(row.titleKey, locale, params)
      : translate("notify.unavailable", locale),
    body:
      row.bodyKey !== null && isMessageKey(row.bodyKey)
        ? translate(row.bodyKey, locale, params)
        : null,
    link: row.link,
    read: row.readAt !== null,
    createdAt: row.createdAt.toISOString(),
  };
};

/** The real store — reads/writes `notifications` through Drizzle. */
export const drizzleNotificationStore = (
  db: DB = defaultDb,
  locale: Locale = "id",
): NotificationStore => ({
  feed: async (userId, q) => {
    const mine = eq(notifications.userId, userId);
    const where = q.unreadOnly ? and(mine, isNull(notifications.readAt)) : mine;

    const rows = await db
      .select({
        id: notifications.id,
        event: notifications.event,
        titleKey: notifications.titleKey,
        bodyKey: notifications.bodyKey,
        params: notifications.params,
        link: notifications.link,
        readAt: notifications.readAt,
        createdAt: notifications.createdAt,
      })
      .from(notifications)
      .where(where)
      // `id` breaks ties so paging is stable when rows share a timestamp — a single mutation can
      // dispatch several notifications inside one transaction.
      .orderBy(desc(notifications.createdAt), desc(notifications.id))
      .limit(q.limit)
      .offset(q.offset);

    const [totals] = await db.select({ total: count() }).from(notifications).where(where);

    // Counted separately from `total`: the badge must show everything outstanding, while `total`
    // follows the current filter (which may be unread-only, making the two coincide). Hits the
    // partial `notifications_user_unread_idx`, so it stays proportional to the unread set.
    const [unreads] = await db
      .select({ unread: count() })
      .from(notifications)
      .where(and(mine, isNull(notifications.readAt)));

    return {
      rows: rows.map((r) => renderRow(r, locale)),
      unread: unreads?.unread ?? 0,
      total: totals?.total ?? 0,
    };
  },

  markRead: async (userId, id) => {
    const updated = await db
      .update(notifications)
      // `coalesce` is what makes a re-mark idempotent: `readAt` records when the row was *first*
      // read, so a second mark must not advance it. Filtering on `readAt is null` instead would
      // match nothing on a re-mark and report a 404 for a row that is present, mine, and read.
      .set({ readAt: sql`coalesce(${notifications.readAt}, now())` })
      // `userId` alongside `id` is what makes this self-scoped: marking someone else's row read
      // isn't a 403 to remember to write, it simply matches nothing.
      .where(and(eq(notifications.id, id), eq(notifications.userId, userId)))
      .returning({ id: notifications.id });
    return updated.length > 0;
  },

  markAllRead: async (userId) => {
    const updated = await db
      .update(notifications)
      .set({ readAt: new Date() })
      .where(and(eq(notifications.userId, userId), isNull(notifications.readAt)))
      .returning({ id: notifications.id });
    return updated.length;
  },
});

const idParamSchema = z.string().uuid();

/**
 * Build the `/notifications` router. Mount under a parent running the request-context middleware, so
 * `c.var.ctx` is populated before the handlers read the actor. Pass a fake store in tests.
 *
 * The store is resolved per-request rather than injected once, because rendering needs the caller's
 * locale — `storeFor` lets a test hand back one spy regardless.
 */
export const notificationRoutes = (
  storeFor: (locale: Locale) => NotificationStore = (locale) =>
    drizzleNotificationStore(defaultDb, locale),
) => {
  const app = new Hono<AppEnv>();

  app.get("/notifications", async (c) => {
    const { actor, locale } = c.var.ctx;
    if (actor === null) return sendError(c, unauthorizedError());

    const parsed = feedQuerySchema.safeParse(c.req.query());
    if (!parsed.success) return sendError(c, validationError({ details: parsed.error.issues }));

    const feed = await storeFor(locale).feed(actor.userId, parsed.data);
    return c.json({
      rows: feed.rows,
      unread: feed.unread,
      total: feed.total,
      limit: parsed.data.limit,
      offset: parsed.data.offset,
    });
  });

  app.post("/notifications/:id/read", async (c) => {
    const { actor, locale } = c.var.ctx;
    if (actor === null) return sendError(c, unauthorizedError());

    const id = idParamSchema.safeParse(c.req.param("id"));
    if (!id.success) return sendError(c, validationError({ details: id.error.issues }));

    // A miss is a 404 whether the row doesn't exist or belongs to someone else — the two are
    // deliberately indistinguishable, so this can't be used to probe for other users' rows.
    const hit = await storeFor(locale).markRead(actor.userId, id.data);
    if (!hit) return sendError(c, notFoundError());

    return c.json({ ok: true });
  });

  app.post("/notifications/read-all", async (c) => {
    const { actor, locale } = c.var.ctx;
    if (actor === null) return sendError(c, unauthorizedError());

    const marked = await storeFor(locale).markAllRead(actor.userId);
    return c.json({ ok: true, marked });
  });

  return app;
};
