/**
 * Approval Routes (M2.4, #35) — the route-header master CRUD wired to the M2.1 framework plus the
 * bespoke ordered-steps sub-router (list / replace / role picker) and its deadlock guard. Run with
 * `bun test`.
 *
 * The generic list mechanics are covered by `master-list.test.ts` and the guard delta by
 * `approval-routes-service.test.ts`; here we check the M2.4 route wiring without a database: every
 * path mounts under the `approval_routes` guard (anonymous → 401, unpermitted → 403), the steps
 * sub-router drives its injectable store correctly (list, replace, role picker), a route the store
 * can't find is a 404, an unknown/inactive step role is a 400, and a stranded save comes back as the
 * localized, re-confirmable 422 (`confirm: true` passing straight through to the store). The real
 * Drizzle stores need Postgres, so those are exercised live under Docker in the delivery notes.
 */

import { describe, expect, test } from "bun:test";
import { type Actor, toPermissionSet } from "@vms/domain";
import { Hono } from "hono";
import {
  type ReplaceStepsResult,
  type RouteStepDTO,
  type StepStore,
  approvalRouteRoutes,
  stepRoutes,
} from "./approval-routes-route";
import { type AppEnv, requestContext } from "./context";

/** A staff actor holding the given verbs on `approval_routes` (the module the whole screen gates on). */
const staff = (verbs: readonly ("view" | "add" | "edit" | "delete")[]): Actor => ({
  userId: "admin-1",
  kind: "internal",
  email: "admin@soechi.id",
  name: "Admin",
  permissions: toPermissionSet(verbs.map((verb) => ({ module: "approval_routes" as const, verb }))),
});

const ROUTE = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ROLE1 = "11111111-1111-4111-8111-111111111111";
const ROLE2 = "22222222-2222-4222-8222-222222222222";

const put = (body: unknown): RequestInit => ({
  method: "PUT",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

const aStep: RouteStepDTO = {
  id: "s1",
  routeId: ROUTE,
  stepNo: 1,
  roleId: ROLE1,
  roleCode: "ap_staff",
  roleNameId: "Staf AP",
  roleNameEn: "AP Staff",
};

/** A configurable fake step store — records the replace call so the router's behaviour can be asserted. */
const fakeStepStore = (overrides: Partial<StepStore> = {}): StepStore & { calls: string[] } => {
  const calls: string[] = [];
  return {
    calls,
    listByRoute: overrides.listByRoute ?? (async () => [aStep]),
    listRoles:
      overrides.listRoles ??
      (async () => [{ id: ROLE1, code: "ap_staff", nameId: "Staf AP", nameEn: "AP Staff" }]),
    replaceSteps:
      overrides.replaceSteps ??
      (async (_ctx, routeId, input): Promise<ReplaceStepsResult | null> => {
        calls.push(
          `replace:${routeId}:${input.steps.map((s) => s.roleId).join(",")}:${input.confirm ?? false}`,
        );
        return {
          ok: true,
          steps: input.steps.map((s, i) => ({ ...aStep, stepNo: i + 1, roleId: s.roleId })),
        };
      }),
  };
};

const stepApp = (actor: () => Actor | null, store: StepStore) => {
  const app = new Hono<AppEnv>();
  app.use("*", requestContext(actor));
  app.route("/console/approval-routes", stepRoutes(store));
  return app;
};

describe("mount + guard — the whole screen is under the approval_routes guard", () => {
  const anon = new Hono<AppEnv>();
  anon.use(
    "*",
    requestContext(() => null),
  );
  anon.route("/console/approval-routes", approvalRouteRoutes(fakeStepStore()));

  for (const [method, path] of [
    ["GET", "/roles"],
    ["GET", `/${ROUTE}/steps`],
    ["GET", ""], // the header list
  ] as const) {
    test(`${method} ${path || "(root)"} → 401 when anonymous`, async () => {
      const res = await anon.request(`/console/approval-routes${path}`, { method });
      expect(res.status).toBe(401);
      expect((await res.json()).error.messageKey).toBe("error.unauthorized");
    });
  }

  test("PUT steps → 403 when the actor lacks approval_routes:edit", async () => {
    const app = stepApp(() => staff(["view"]), fakeStepStore());
    const res = await app.request(
      `/console/approval-routes/${ROUTE}/steps`,
      put({ steps: [{ roleId: ROLE1 }] }),
    );
    expect(res.status).toBe(403);
  });
});

describe("GET /roles — the approver-role picker", () => {
  test("returns the active roles for a view-permitted actor", async () => {
    const app = stepApp(() => staff(["view"]), fakeStepStore());
    const res = await app.request("/console/approval-routes/roles");
    expect(res.status).toBe(200);
    expect((await res.json()).roles[0].code).toBe("ap_staff");
  });
});

describe("GET /:routeId/steps — a route's ordered steps", () => {
  test("returns the steps in order", async () => {
    const app = stepApp(() => staff(["view"]), fakeStepStore());
    const res = await app.request(`/console/approval-routes/${ROUTE}/steps`);
    expect(res.status).toBe(200);
    expect((await res.json()).items).toHaveLength(1);
  });

  test("404 when the route is gone (store returns null)", async () => {
    const app = stepApp(() => staff(["view"]), fakeStepStore({ listByRoute: async () => null }));
    const res = await app.request(`/console/approval-routes/${ROUTE}/steps`);
    expect(res.status).toBe(404);
  });
});

describe("PUT /:routeId/steps — replace the ordered steps", () => {
  test("replaces and returns the new steps; the ordered role ids reach the store", async () => {
    const store = fakeStepStore();
    const app = stepApp(() => staff(["edit"]), store);
    const res = await app.request(
      `/console/approval-routes/${ROUTE}/steps`,
      put({ steps: [{ roleId: ROLE1 }, { roleId: ROLE2 }] }),
    );
    expect(res.status).toBe(200);
    expect((await res.json()).items).toHaveLength(2);
    expect(store.calls).toEqual([`replace:${ROUTE}:${ROLE1},${ROLE2}:false`]);
  });

  test("malformed JSON body → 400 validation", async () => {
    const app = stepApp(() => staff(["edit"]), fakeStepStore());
    const res = await app.request(`/console/approval-routes/${ROUTE}/steps`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: "{",
    });
    expect(res.status).toBe(400);
  });

  test("an empty step list → 400 (a route needs at least one step)", async () => {
    const app = stepApp(() => staff(["edit"]), fakeStepStore());
    const res = await app.request(`/console/approval-routes/${ROUTE}/steps`, put({ steps: [] }));
    expect(res.status).toBe(400);
  });

  test("route not found (store returns null) → 404", async () => {
    const app = stepApp(() => staff(["edit"]), fakeStepStore({ replaceSteps: async () => null }));
    const res = await app.request(
      `/console/approval-routes/${ROUTE}/steps`,
      put({ steps: [{ roleId: ROLE1 }] }),
    );
    expect(res.status).toBe(404);
  });

  test("an unknown/inactive step role → 400 validation", async () => {
    const store = fakeStepStore({ replaceSteps: async () => ({ ok: false, unknownRole: true }) });
    const app = stepApp(() => staff(["edit"]), store);
    const res = await app.request(
      `/console/approval-routes/${ROUTE}/steps`,
      put({ steps: [{ roleId: ROLE2 }] }),
    );
    expect(res.status).toBe(400);
  });

  test("a stranded save → 422 deadlock warning naming the roles, re-confirmable", async () => {
    const store = fakeStepStore({
      replaceSteps: async () => ({
        ok: false,
        deadlock: [{ id: ROLE2, code: "hod", nameId: "HOD", nameEn: "HOD" }],
      }),
    });
    const app = stepApp(() => staff(["edit"]), store);
    const res = await app.request(
      `/console/approval-routes/${ROUTE}/steps`,
      put({ steps: [{ roleId: ROLE2 }] }),
    );
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error.messageKey).toBe("approvalRoutes.deadlock.warning");
    expect(body.error.params.roles).toBe("hod");
  });

  test("confirm: true passes straight through to the store (the re-submit that overrides the guard)", async () => {
    const store = fakeStepStore();
    const app = stepApp(() => staff(["edit"]), store);
    const res = await app.request(
      `/console/approval-routes/${ROUTE}/steps`,
      put({ steps: [{ roleId: ROLE1 }], confirm: true }),
    );
    expect(res.status).toBe(200);
    expect(store.calls).toEqual([`replace:${ROUTE}:${ROLE1}:true`]);
  });
});
