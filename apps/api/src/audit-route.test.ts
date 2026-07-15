/**
 * Audit viewer (M1.4, #23) — `GET /console/audit`. Run with `bun test`.
 *
 * Drives the route's guard → validate → query → shape orchestration through a real Hono app with a
 * fake {@link AuditStore}, so the whole spine — the RBAC gate, query parsing, and the filter/paging
 * contract passed to the store — is checked without Postgres. The Drizzle read itself is proven live
 * by hitting the endpoint under `docker compose up`.
 */

import { describe, expect, test } from "bun:test";
import { type Actor, toPermissionSet } from "@vms/domain";
import { Hono } from "hono";
import { type AuditPage, type AuditQuery, type AuditRowDTO, auditRoutes } from "./audit-route";
import { type AppEnv, requestContext } from "./context";

const staff = (permissions: Actor["permissions"]): Actor => ({
  userId: "user-1",
  kind: "internal",
  email: "staff@soechi.id",
  name: "Staff",
  permissions,
});

const canView = () => staff(toPermissionSet([{ module: "audit", verb: "view" }]));

/** A fake store that records the query it was handed and serves a fixed page. */
const fakeStore = (page: AuditPage = { rows: [], total: 0 }) => {
  const queries: AuditQuery[] = [];
  const store = {
    query: async (q: AuditQuery) => {
      queries.push(q);
      return page;
    },
  };
  return { store, queries, lastQuery: () => queries[queries.length - 1] };
};

/** Mount the route under a parent running the context middleware — the real wiring. */
const appWith = (
  resolveActor: () => Actor | null,
  store: ReturnType<typeof fakeStore>["store"],
) => {
  const app = new Hono<AppEnv>();
  app.use("*", requestContext(resolveActor));
  app.route("/console", auditRoutes(store));
  return app;
};

const row = (over: Partial<AuditRowDTO> = {}): AuditRowDTO => ({
  id: "row-1",
  at: "2026-07-15T00:00:00.000Z",
  actorUserId: "user-1",
  actorName: "Staff",
  actorEmail: "staff@soechi.id",
  action: "user.signed_in",
  module: null,
  subjectType: "user",
  subjectId: "user-1",
  ip: "10.0.0.1",
  ...over,
});

describe("GET /console/audit", () => {
  test("401 when unauthenticated (deny-by-default)", async () => {
    const { store, queries } = fakeStore();
    const res = await appWith(() => null, store).request("/console/audit");
    expect(res.status).toBe(401);
    expect((await res.json()).error.messageKey).toBe("error.unauthorized");
    // The guard rejects before any read runs.
    expect(queries).toHaveLength(0);
  });

  test("403 when the actor lacks audit:view — and the store is never queried", async () => {
    const { store, queries } = fakeStore();
    const res = await appWith(() => staff(toPermissionSet([])), store).request("/console/audit");
    expect(res.status).toBe(403);
    expect(queries).toHaveLength(0);
  });

  test("with audit:view and no filters — returns the page under default paging", async () => {
    const { store, queries } = fakeStore({ rows: [row()], total: 1 });
    const res = await appWith(canView, store).request("/console/audit?lang=en");

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.total).toBe(1);
    expect(body.limit).toBe(50);
    expect(body.offset).toBe(0);
    expect(body.rows).toHaveLength(1);
    expect(body.rows[0].action).toBe("user.signed_in");
    expect(body.rows[0].actorName).toBe("Staff");

    // No filters present → the store gets only the paging defaults.
    expect(queries[0]).toEqual({ limit: 50, offset: 0 });
  });

  test("passes every filter through to the store, coercing dates and paging", async () => {
    const { store, lastQuery } = fakeStore();
    const qs = new URLSearchParams({
      actor: "sari",
      action: "signed_in",
      module: "audit",
      subjectType: "user",
      subjectId: "11111111-1111-1111-1111-111111111111",
      from: "2026-07-01",
      to: "2026-07-15",
      limit: "25",
      offset: "50",
    });
    const res = await appWith(canView, store).request(`/console/audit?${qs}`);
    expect(res.status).toBe(200);

    const q = lastQuery();
    expect(q.actor).toBe("sari");
    expect(q.action).toBe("signed_in");
    expect(q.module).toBe("audit");
    expect(q.subjectType).toBe("user");
    expect(q.subjectId).toBe("11111111-1111-1111-1111-111111111111");
    expect(q.from).toEqual(new Date("2026-07-01"));
    expect(q.to).toEqual(new Date("2026-07-15"));
    expect(q.limit).toBe(25);
    expect(q.offset).toBe(50);
  });

  test("blank filter values are dropped, not treated as filters", async () => {
    const { store, lastQuery } = fakeStore();
    const res = await appWith(canView, store).request("/console/audit?action=&module=&actor=");
    expect(res.status).toBe(200);
    // Empty strings must not reach the store as filters.
    expect(lastQuery()).toEqual({ limit: 50, offset: 0 });
  });

  test("400 on an invalid filter — unknown module, non-uuid subjectId, over-max limit", async () => {
    const { store } = fakeStore();
    const app = appWith(canView, store);

    for (const bad of [
      "module=nope",
      "subjectId=not-a-uuid",
      "limit=9999",
      "limit=abc",
      "from=not-a-date",
    ]) {
      const res = await app.request(`/console/audit?${bad}`);
      expect(res.status).toBe(400);
      expect((await res.json()).error.code).toBe("validation");
    }
  });
});
