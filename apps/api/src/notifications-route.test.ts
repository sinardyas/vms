/**
 * Notification centre route tests (M6.3, #79, ADR-0016).
 *
 * The store is faked, so these cover the surface's own rules — self-scoping, the 401/404 signals, the
 * read-time locale — without Postgres. The Drizzle store's SQL is proven live against Docker.
 */

import { describe, expect, test } from "bun:test";
import type { Actor } from "@vms/domain";
import { toPermissionSet } from "@vms/domain";
import { Hono } from "hono";
import { type AppEnv, requestContext } from "./context";
import {
  type NotificationFeed,
  type NotificationStore,
  notificationRoutes,
} from "./notifications-route";

/** An actor with *no* grants at all — the centre must work anyway; it isn't permission-scoped. */
const reader = (userId: string, kind: Actor["kind"] = "internal"): Actor => ({
  userId,
  kind,
  email: `${userId}@soechi.id`,
  name: "Reader",
  permissions: toPermissionSet([]),
});

const emptyFeed: NotificationFeed = { rows: [], unread: 0, total: 0 };

/** A store that records what it was asked for, so the tests can assert the scoping. */
const spyStore = (feed: NotificationFeed = emptyFeed, hit = true) => {
  const calls: { feedFor: string[]; markRead: [string, string][]; markAllFor: string[] } = {
    feedFor: [],
    markRead: [],
    markAllFor: [],
  };
  const store: NotificationStore = {
    feed: async (userId) => {
      calls.feedFor.push(userId);
      return feed;
    },
    markRead: async (userId, id) => {
      calls.markRead.push([userId, id]);
      return hit;
    },
    markAllRead: async (userId) => {
      calls.markAllFor.push(userId);
      return 3;
    },
  };
  return { store, calls };
};

const appWith = (resolveActor: () => Actor | null, store: NotificationStore) => {
  const app = new Hono<AppEnv>();
  app.use("*", requestContext(resolveActor));
  app.route(
    "/",
    notificationRoutes(() => store),
  );
  return app;
};

describe("GET /notifications", () => {
  test("an anonymous caller gets 401, not an empty feed", async () => {
    const { store } = spyStore();
    const res = await appWith(() => null, store).request("/notifications");
    expect(res.status).toBe(401);
  });

  test("reads the session's own rows — the user id is never taken from the request", async () => {
    const { store, calls } = spyStore();
    // A caller trying to widen the scope via the query string is simply ignored.
    const res = await appWith(() => reader("user-1"), store).request(
      "/notifications?userId=user-2",
    );

    expect(res.status).toBe(200);
    expect(calls.feedFor).toEqual(["user-1"]);
  });

  test("an actor with no grants still reads their bell (it isn't RBAC-gated)", async () => {
    const { store } = spyStore();
    const res = await appWith(() => reader("user-1"), store).request("/notifications");
    expect(res.status).toBe(200);
  });

  test("a vendor-kind actor reads their bell too (ADR-0016 gave them in-app rows)", async () => {
    const { store, calls } = spyStore();
    const res = await appWith(() => reader("vendor-1", "vendor"), store).request("/notifications");

    expect(res.status).toBe(200);
    expect(calls.feedFor).toEqual(["vendor-1"]);
  });

  test("carries the unread total alongside the page", async () => {
    const { store } = spyStore({
      rows: [
        {
          id: "n1",
          event: "decision",
          title: "Ditolak",
          body: "Alasannya…",
          link: "/registration",
          read: false,
          createdAt: "2026-07-17T00:00:00.000Z",
        },
      ],
      unread: 7,
      total: 12,
    });
    const res = await appWith(() => reader("user-1"), store).request("/notifications");
    const body = (await res.json()) as { rows: unknown[]; unread: number; total: number };

    // `unread` spans the whole feed, not the page — the badge counts what's outstanding.
    expect(body.unread).toBe(7);
    expect(body.total).toBe(12);
    expect(body.rows).toHaveLength(1);
  });

  test("rejects a limit past the ceiling rather than honouring it", async () => {
    const { store } = spyStore();
    const res = await appWith(() => reader("user-1"), store).request("/notifications?limit=5000");
    expect(res.status).toBe(400);
  });

  test("renders in the request's locale — for a self-read, the actor is the recipient", async () => {
    // The store is built per-request *from the locale*; capture what the route resolves it with.
    const locales: string[] = [];
    const { store } = spyStore();
    const app = new Hono<AppEnv>();
    app.use(
      "*",
      requestContext(() => reader("user-1")),
    );
    app.route(
      "/",
      notificationRoutes((locale) => {
        locales.push(locale);
        return store;
      }),
    );

    await app.request("/notifications?lang=en");
    await app.request("/notifications?lang=id");

    // Rows store keys, never copy (M6.1) — so the same rows re-render per request, and flipping the
    // locale switch changes the language without anything being rewritten in the database.
    expect(locales).toEqual(["en", "id"]);
  });
});

describe("POST /notifications/:id/read", () => {
  const uuid = "11111111-1111-4111-8111-111111111111";

  test("an anonymous caller gets 401", async () => {
    const { store } = spyStore();
    const res = await appWith(() => null, store).request(`/notifications/${uuid}/read`, {
      method: "POST",
    });
    expect(res.status).toBe(401);
  });

  test("marks read scoped to the session's user", async () => {
    const { store, calls } = spyStore();
    const res = await appWith(() => reader("user-1"), store).request(
      `/notifications/${uuid}/read`,
      { method: "POST" },
    );

    expect(res.status).toBe(200);
    // The user id rides into the statement — that's the whole of the authorization.
    expect(calls.markRead).toEqual([["user-1", uuid]]);
  });

  test("someone else's row is a 404 — indistinguishable from one that doesn't exist", async () => {
    // The store reports a miss because the `userId` predicate matched nothing.
    const { store } = spyStore(emptyFeed, false);
    const res = await appWith(() => reader("user-1"), store).request(
      `/notifications/${uuid}/read`,
      { method: "POST" },
    );

    // Not a 403: a 403 would confirm the row exists, turning this into a probe for other users' rows.
    expect(res.status).toBe(404);
  });

  test("a malformed id is a 400, not a store call", async () => {
    const { store, calls } = spyStore();
    const res = await appWith(() => reader("user-1"), store).request("/notifications/nope/read", {
      method: "POST",
    });

    expect(res.status).toBe(400);
    expect(calls.markRead).toEqual([]);
  });
});

describe("POST /notifications/read-all", () => {
  test("an anonymous caller gets 401", async () => {
    const { store } = spyStore();
    const res = await appWith(() => null, store).request("/notifications/read-all", {
      method: "POST",
    });
    expect(res.status).toBe(401);
  });

  test("clears the session's own unread rows and reports the count", async () => {
    const { store, calls } = spyStore();
    const res = await appWith(() => reader("user-1"), store).request("/notifications/read-all", {
      method: "POST",
    });
    const body = (await res.json()) as { marked: number };

    expect(res.status).toBe(200);
    expect(body.marked).toBe(3);
    expect(calls.markAllFor).toEqual(["user-1"]);
  });
});
