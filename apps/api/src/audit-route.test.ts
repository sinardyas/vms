/**
 * Walking-skeleton route (#8) — `GET /console/audit`. Run with `bun test`.
 *
 * Drives the route's orchestration (guard → record → read → shape) through a real Hono app with a
 * fake {@link AuditStore}, so the whole spine is checked without Postgres. The DB round-trip itself
 * is proven live by hitting the endpoint under `docker compose up` (see the ticket resolution).
 */

import { describe, expect, test } from "bun:test";
import { type Actor, toPermissionSet } from "@vms/domain";
import { Hono } from "hono";
import { type AuditRowDTO, type AuditStore, auditRoutes } from "./audit-route";
import { type AppEnv, requestContext } from "./context";

const staff = (permissions: Actor["permissions"]): Actor => ({
  userId: "user-1",
  kind: "internal",
  email: "staff@soechi.id",
  name: "Staff",
  permissions,
});

/** A fake store that records what the route wrote and serves a fixed recent list. */
const fakeStore = (recent: AuditRowDTO[] = []) => {
  const recorded: { action: string; module?: string; subjectType: string }[] = [];
  let ensured = 0;
  const store: AuditStore = {
    ensureActor: async () => {
      ensured += 1;
    },
    record: async (_ctx, entry) => {
      recorded.push({ action: entry.action, module: entry.module, subjectType: entry.subjectType });
    },
    recent: async () => recent,
  };
  return { store, recorded, ensuredCount: () => ensured };
};

/** Mount the route under a parent running the context middleware — the real wiring. */
const appWith = (resolveActor: () => Actor | null, store: AuditStore) => {
  const app = new Hono<AppEnv>();
  app.use("*", requestContext(resolveActor));
  app.route("/console", auditRoutes(store));
  return app;
};

const row = (over: Partial<AuditRowDTO> = {}): AuditRowDTO => ({
  id: "row-1",
  at: "2026-07-15T00:00:00.000Z",
  actorUserId: "user-1",
  action: "audit.viewed",
  module: "audit",
  subjectType: "audit_log",
  subjectId: null,
  ip: null,
  ...over,
});

describe("GET /console/audit", () => {
  test("401 when unauthenticated (the default before M1 / dev actor off)", async () => {
    const { store } = fakeStore();
    const res = await appWith(() => null, store).request("/console/audit");
    expect(res.status).toBe(401);
    expect((await res.json()).error.messageKey).toBe("error.unauthorized");
  });

  test("403 when the actor lacks audit:view", async () => {
    const { store, recorded } = fakeStore();
    const res = await appWith(() => staff(toPermissionSet([])), store).request("/console/audit");
    expect(res.status).toBe(403);
    // Guard rejects before any write happens.
    expect(recorded).toHaveLength(0);
  });

  test("with audit:view — records this view, then returns the trail it read back", async () => {
    const { store, recorded, ensuredCount } = fakeStore([row()]);
    const actor = () => staff(toPermissionSet([{ module: "audit", verb: "view" }]));
    const res = await appWith(actor, store).request("/console/audit?lang=en");

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.actor).toEqual({ name: "Staff", email: "staff@soechi.id" });
    expect(body.locale).toBe("en");
    expect(body.rows).toHaveLength(1);
    expect(body.rows[0].action).toBe("audit.viewed");

    // The slice's spine: it ensured the actor, then wrote exactly the view it was about to read.
    expect(ensuredCount()).toBe(1);
    expect(recorded).toEqual([
      { action: "audit.viewed", module: "audit", subjectType: "audit_log" },
    ]);
  });
});
