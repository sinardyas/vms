/**
 * M0.4 cross-cutting primitives — request context, audit writer, RBAC guard.
 * Run with `bun test`. Excluded from `tsc` (bun:test is a runtime import).
 *
 * Drives the seams through a real Hono app (no DB needed): the audit writer is exercised against a
 * fake insert sink so the append-only contract is checked without Postgres.
 */

import { describe, expect, test } from "bun:test";
import { type Actor, toPermissionSet } from "@vms/domain";
import { Hono } from "hono";
import { type AuditSink, writeAudit } from "./audit";
import { type AppEnv, requestContext } from "./context";
import { requirePermission } from "./rbac";

const staff = (permissions: Actor["permissions"]): Actor => ({
  userId: "user-1",
  kind: "internal",
  email: "staff@soechi.id",
  name: "Staff",
  permissions,
});

describe("requestContext middleware", () => {
  test("builds locale / ip / ua and defaults to an unauthenticated actor", async () => {
    const app = new Hono<AppEnv>();
    app.use("*", requestContext());
    app.get("/probe", (c) => {
      const { actor, locale, ip, userAgent } = c.var.ctx;
      return c.json({ hasActor: actor !== null, locale, ip, userAgent });
    });

    const res = await app.request("/probe?lang=en", {
      headers: { "user-agent": "vitest", "x-forwarded-for": "203.0.113.7, 10.0.0.1" },
    });
    expect(await res.json()).toEqual({
      hasActor: false,
      locale: "en",
      ip: "203.0.113.7",
      userAgent: "vitest",
    });
  });

  test("uses the injected actor resolver (the M1 seam)", async () => {
    const app = new Hono<AppEnv>();
    app.use(
      "*",
      requestContext(() => staff(toPermissionSet([]))),
    );
    app.get("/me", (c) => c.json({ email: c.var.ctx.actor?.email }));

    const res = await app.request("/me");
    expect(await res.json()).toEqual({ email: "staff@soechi.id" });
  });
});

describe("requirePermission guard", () => {
  const guardedApp = (resolveActor: () => Actor | null) => {
    const app = new Hono<AppEnv>();
    app.use("*", requestContext(resolveActor));
    app.get("/vendors", requirePermission("vendors", "view"), (c) => c.text("ok"));
    return app;
  };

  test("401 when unauthenticated", async () => {
    const res = await guardedApp(() => null).request("/vendors");
    expect(res.status).toBe(401);
    expect((await res.json()).error.messageKey).toBe("error.unauthorized");
  });

  test("403 when the actor lacks the grant, localized to the request", async () => {
    const res = await guardedApp(() => staff(toPermissionSet([]))).request("/vendors", {
      headers: { "accept-language": "en" },
    });
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error.code).toBe("forbidden");
    expect(body.error.message).toBe("You do not have permission for this action.");
  });

  test("passes through when the grant is present", async () => {
    const app = guardedApp(() => staff(toPermissionSet([{ module: "vendors", verb: "view" }])));
    const res = await app.request("/vendors");
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("ok");
  });
});

describe("writeAudit", () => {
  const fakeSink = () => {
    const rows: Record<string, unknown>[] = [];
    const sink = {
      insert: () => ({ values: (v: Record<string, unknown>) => rows.push(v) }),
    } as unknown as AuditSink;
    return { sink, rows };
  };

  test("appends an action-log row, mapping actor / ip / ua off the context", async () => {
    const { sink, rows } = fakeSink();
    const ctx = {
      actor: staff(toPermissionSet([])),
      locale: "id" as const,
      ip: "203.0.113.7",
      userAgent: "vitest",
    };
    await writeAudit(sink, ctx, {
      action: "vendor.submitted",
      module: "vendors",
      subjectType: "vendor",
      subjectId: "vendor-9",
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      actorUserId: "user-1",
      action: "vendor.submitted",
      module: "vendors",
      subjectType: "vendor",
      subjectId: "vendor-9",
      ip: "203.0.113.7",
      userAgent: "vitest",
    });
  });

  test("attributes a system / unauthenticated action to a null actor", async () => {
    const { sink, rows } = fakeSink();
    const ctx = { actor: null, locale: "id" as const };
    await writeAudit(sink, ctx, { action: "seed.loaded", subjectType: "system" });
    expect(rows[0]?.actorUserId).toBeNull();
  });
});
