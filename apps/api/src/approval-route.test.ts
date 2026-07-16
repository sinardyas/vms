/**
 * Approval engine route tests (M4.2, #57) — DB-free, driving the Hono router with a fake store.
 *
 * Covers the RBAC guard (view vs approve), the queue filter plumbing (`?mine` / `?vendorId`), detail
 * 404, the approve/reject decisions (including reject's required reason and the already-resolved 409),
 * and reassign (bad step 400, not-actionable 409). The engine's advance/resolve/effect logic itself is
 * unit-tested in `@vms/domain`'s `applyDecision`; here we assert the router wires it correctly.
 */

import { describe, expect, test } from "bun:test";
import { type Actor, type RbacVerb, toPermissionSet } from "@vms/domain";
import { Hono } from "hono";
import {
  type ApprovalRequestDetailDTO,
  type ApprovalStore,
  type QueueFilter,
  approvalRoutes,
} from "./approval-route";
import { type AppEnv, requestContext } from "./context";

const REQ = "11111111-1111-4111-8111-111111111111";
const VENDOR = "22222222-2222-4222-8222-222222222222";
const USER = "user-1";
const ASSIGNEE = "99999999-9999-4999-8999-999999999999";

/** An internal actor holding the given verbs on the `approvals` module. */
const actor = (verbs: readonly RbacVerb[]): Actor => ({
  userId: USER,
  kind: "internal",
  email: "u@soechi.id",
  name: "U",
  permissions: toPermissionSet(verbs.map((verb) => ({ module: "approvals" as const, verb }))),
});

const json = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

const detail: ApprovalRequestDetailDTO = {
  id: REQ,
  subjectVendorId: VENDOR,
  vendorName: "PT Contoh Jaya",
  trigger: "new_vendor_registration",
  status: "pending",
  currentStepNo: 1,
  currentStepRoleId: "role-ap-staff",
  currentStepRoleCode: "ap_staff",
  currentStepRoleNameId: "Staf AP",
  currentStepRoleNameEn: "AP Staff",
  currentAssigneeUserId: null,
  currentAssigneeName: null,
  submittedBy: "submitter",
  createdAt: "2026-07-16T00:00:00.000Z",
  routeId: "route-1",
  resolvedAt: null,
  payload: null,
  steps: [
    {
      stepNo: 1,
      roleId: "role-ap-staff",
      roleCode: "ap_staff",
      roleNameId: "Staf AP",
      roleNameEn: "AP Staff",
      assigneeUserId: null,
      assigneeName: null,
      decision: "pending",
      decidedBy: null,
      decidedByName: null,
      reason: null,
      decidedAt: null,
      isOverride: false,
    },
  ],
  activationGate: { ok: true, requiredCount: 2, verifiedCount: 2, blockers: [] },
};

type Spy = {
  listFilters: QueueFilter[];
  decideCalls: { requestId: string; decision: string; reason: string | null }[];
  reassignCalls: { requestId: string; stepNo: number; assigneeUserId: string }[];
};

const fakeStore = (overrides: Partial<ApprovalStore> = {}): ApprovalStore & { spy: Spy } => {
  const spy: Spy = { listFilters: [], decideCalls: [], reassignCalls: [] };
  return {
    spy,
    listOpen: async (filter) => {
      spy.listFilters.push(filter);
      return [
        {
          id: REQ,
          subjectVendorId: VENDOR,
          vendorName: "PT Contoh Jaya",
          trigger: "new_vendor_registration",
          status: "pending",
          currentStepNo: 1,
          currentStepRoleId: "role-ap-staff",
          currentStepRoleCode: "ap_staff",
          currentStepRoleNameId: "Staf AP",
          currentStepRoleNameEn: "AP Staff",
          currentAssigneeUserId: null,
          currentAssigneeName: null,
          submittedBy: "submitter",
          createdAt: "2026-07-16T00:00:00.000Z",
        },
      ];
    },
    getDetail: async (id) => (id === REQ ? detail : null),
    decide: async (_ctx, input) => {
      spy.decideCalls.push({
        requestId: input.requestId,
        decision: input.decision,
        reason: input.reason,
      });
      return { ok: true, detail };
    },
    reassign: async (_ctx, input) => {
      spy.reassignCalls.push(input);
      return { ok: true, detail };
    },
    rolesForUser: async () => ["role-ap-staff", "role-ap-supervisor"],
    candidatesForStep: async () => [{ userId: ASSIGNEE, name: "Budi", email: "budi@soechi.id" }],
    ...overrides,
  };
};

const mount = (a: () => Actor | null, store: ApprovalStore) => {
  const app = new Hono<AppEnv>();
  app.use("*", requestContext(a));
  app.route("/console/approvals", approvalRoutes(store));
  return app;
};

describe("guard", () => {
  test("anonymous → 401", async () => {
    const res = await mount(() => null, fakeStore()).request("/console/approvals");
    expect(res.status).toBe(401);
  });

  test("without approvals:view → 403", async () => {
    const res = await mount(() => actor([]), fakeStore()).request("/console/approvals");
    expect(res.status).toBe(403);
  });

  test("approve without approvals:approve → 403", async () => {
    const res = await mount(() => actor(["view"]), fakeStore()).request(
      `/console/approvals/${REQ}/approve`,
      json("POST", {}),
    );
    expect(res.status).toBe(403);
  });
});

describe("GET / — queue", () => {
  test("lists open requests", async () => {
    const res = await mount(() => actor(["view"]), fakeStore()).request("/console/approvals");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: { id: string }[] };
    expect(body.items.map((i) => i.id)).toEqual([REQ]);
  });

  test("?mine scopes the filter to the caller; ?vendorId passes through", async () => {
    const store = fakeStore();
    await mount(() => actor(["view"]), store).request(
      `/console/approvals?mine=1&vendorId=${VENDOR}`,
    );
    expect(store.spy.listFilters).toEqual([{ vendorId: VENDOR, assigneeUserId: USER }]);
  });

  test("no filters → open queue, unscoped", async () => {
    const store = fakeStore();
    await mount(() => actor(["view"]), store).request("/console/approvals");
    expect(store.spy.listFilters).toEqual([
      { vendorId: undefined, assigneeUserId: undefined, roleIds: undefined },
    ]);
  });

  test("?role scopes the filter to the caller's role ids", async () => {
    const store = fakeStore();
    await mount(() => actor(["view"]), store).request("/console/approvals?role=1");
    expect(store.spy.listFilters).toEqual([
      {
        vendorId: undefined,
        assigneeUserId: undefined,
        roleIds: ["role-ap-staff", "role-ap-supervisor"],
      },
    ]);
  });

  test("?role with a role-less caller → empty role set (empty queue)", async () => {
    const store = fakeStore({ rolesForUser: async () => [] });
    await mount(() => actor(["view"]), store).request("/console/approvals?role=1");
    expect(store.spy.listFilters).toEqual([
      { vendorId: undefined, assigneeUserId: undefined, roleIds: [] },
    ]);
  });
});

describe("GET /:id/steps/:stepNo/candidates", () => {
  test("lists the step's candidate assignees", async () => {
    const res = await mount(() => actor(["approve"]), fakeStore()).request(
      `/console/approvals/${REQ}/steps/1/candidates`,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: { userId: string }[] };
    expect(body.items.map((i) => i.userId)).toEqual([ASSIGNEE]);
  });

  test("requires approvals:approve (a viewer → 403)", async () => {
    const res = await mount(() => actor(["view"]), fakeStore()).request(
      `/console/approvals/${REQ}/steps/1/candidates`,
    );
    expect(res.status).toBe(403);
  });

  test("non-integer step → 400", async () => {
    const res = await mount(() => actor(["approve"]), fakeStore()).request(
      `/console/approvals/${REQ}/steps/x/candidates`,
    );
    expect(res.status).toBe(400);
  });
});

describe("GET /:id — detail", () => {
  test("returns the request detail", async () => {
    const res = await mount(() => actor(["view"]), fakeStore()).request(
      `/console/approvals/${REQ}`,
    );
    expect(res.status).toBe(200);
    expect((await res.json()).item.id).toBe(REQ);
  });

  test("unknown → 404", async () => {
    const res = await mount(() => actor(["view"]), fakeStore()).request(
      "/console/approvals/does-not-exist",
    );
    expect(res.status).toBe(404);
  });
});

describe("POST /:id/approve", () => {
  test("approves and returns fresh detail", async () => {
    const store = fakeStore();
    const res = await mount(() => actor(["approve"]), store).request(
      `/console/approvals/${REQ}/approve`,
      json("POST", { reason: "looks good" }),
    );
    expect(res.status).toBe(200);
    expect(store.spy.decideCalls).toEqual([
      { requestId: REQ, decision: "approve", reason: "looks good" },
    ]);
  });

  test("already-resolved request → 409 notPending", async () => {
    const store = fakeStore({ decide: async () => ({ ok: false, reason: "not_pending" }) });
    const res = await mount(() => actor(["approve"]), store).request(
      `/console/approvals/${REQ}/approve`,
      json("POST", {}),
    );
    expect(res.status).toBe(409);
    expect((await res.json()).error.messageKey).toBe("error.approval.notPending");
  });

  test("unknown request → 404", async () => {
    const store = fakeStore({ decide: async () => ({ ok: false, reason: "not_found" }) });
    const res = await mount(() => actor(["approve"]), store).request(
      `/console/approvals/${REQ}/approve`,
      json("POST", {}),
    );
    expect(res.status).toBe(404);
  });

  test("blocked activation gate (M5.2) → 409 with the localized N-of-M count", async () => {
    // The blockers themselves reach the console via the `activationGate` read on the request detail;
    // the block error carries the localized "N of M verified" message (params).
    const store = fakeStore({
      decide: async () => ({
        ok: false,
        reason: "gate_blocked",
        gate: { ok: false, requiredCount: 3, verifiedCount: 1, blockers: ["doc-b", "doc-c"] },
      }),
    });
    const res = await mount(() => actor(["approve"]), store).request(
      `/console/approvals/${REQ}/approve`,
      json("POST", {}),
    );
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: { messageKey: string; params: unknown } };
    expect(body.error.messageKey).toBe("error.approval.activationGateBlocked");
    expect(body.error.params).toEqual({ verified: 1, required: 3 });
  });
});

describe("POST /:id/reject", () => {
  test("requires a reason → 400 reasonRequired", async () => {
    const store = fakeStore();
    const res = await mount(() => actor(["approve"]), store).request(
      `/console/approvals/${REQ}/reject`,
      json("POST", {}),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error.messageKey).toBe("error.approval.reasonRequired");
    expect(store.spy.decideCalls).toEqual([]); // never reached the store
  });

  test("rejects with a reason", async () => {
    const store = fakeStore();
    const res = await mount(() => actor(["approve"]), store).request(
      `/console/approvals/${REQ}/reject`,
      json("POST", { reason: "missing SIUP" }),
    );
    expect(res.status).toBe(200);
    expect(store.spy.decideCalls).toEqual([
      { requestId: REQ, decision: "reject", reason: "missing SIUP" },
    ]);
  });
});

describe("POST /:id/steps/:stepNo/reassign", () => {
  test("reassigns the current step", async () => {
    const store = fakeStore();
    const res = await mount(() => actor(["approve"]), store).request(
      `/console/approvals/${REQ}/steps/1/reassign`,
      json("POST", { assigneeUserId: ASSIGNEE }),
    );
    expect(res.status).toBe(200);
    expect(store.spy.reassignCalls).toEqual([
      { requestId: REQ, stepNo: 1, assigneeUserId: ASSIGNEE },
    ]);
  });

  test("non-integer step → 400", async () => {
    const res = await mount(() => actor(["approve"]), fakeStore()).request(
      `/console/approvals/${REQ}/steps/abc/reassign`,
      json("POST", { assigneeUserId: ASSIGNEE }),
    );
    expect(res.status).toBe(400);
  });

  test("not the current open step → 409 stepNotActionable", async () => {
    const store = fakeStore({ reassign: async () => ({ ok: false, reason: "not_actionable" }) });
    const res = await mount(() => actor(["approve"]), store).request(
      `/console/approvals/${REQ}/steps/2/reassign`,
      json("POST", { assigneeUserId: ASSIGNEE }),
    );
    expect(res.status).toBe(409);
    expect((await res.json()).error.messageKey).toBe("error.approval.stepNotActionable");
  });
});
