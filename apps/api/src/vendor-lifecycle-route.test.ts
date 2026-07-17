/**
 * Vendor service lifecycle — deactivate / raise reactivation (M6.4, #80). Run with `bun test`.
 *
 * Database-free: a fake stands in for the {@link VendorLifecycleStore}, so this pins the route's
 * contract — the RBAC guard and the **verb asymmetry** that is the point of the milestone (deactivate
 * needs `vendors:delete`, which only the sysadmin holds; raising a reactivation needs `vendors:edit`,
 * which the AP chain holds), the staff-only guard, the state gates (409), the mandatory reason (422),
 * and the in-flight-request locks. The transitions themselves are pure and tested in `@vms/domain`;
 * the reactivation's *resolution* lives in `approval-route.ts`.
 */

import { describe, expect, test } from "bun:test";
import { type Actor, type RbacVerb, toPermissionSet } from "@vms/domain";
import { Hono } from "hono";
import { type AppEnv, requestContext } from "./context";
import { requireInternalActor } from "./vendor-access";
import {
  type DeactivateOutcome,
  type ReactivateOutcome,
  type VendorLifecycleRef,
  type VendorLifecycleStore,
  vendorLifecycleRoutes,
} from "./vendor-lifecycle-route";

const VENDOR = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const REQUEST = "11111111-1111-4111-8111-111111111111";

const actorWith = (verbs: readonly RbacVerb[], kind: Actor["kind"] = "internal"): Actor => ({
  userId: "user-1",
  kind,
  email: "u@soechi.id",
  name: "U",
  permissions: toPermissionSet(verbs.map((verb) => ({ module: "vendors" as const, verb }))),
});

/** The System Administrator — the only seeded role holding `vendors:delete` (#21). */
const sysadmin = () => actorWith(["delete", "edit", "view"]);
/** An AP-chain actor: may raise a reactivation, may not deactivate. */
const apStaff = () => actorWith(["edit", "view"]);

const json = (body: unknown): RequestInit => ({
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

const activeVendor: VendorLifecycleRef = { id: VENDOR, name: "PT Contoh Jaya", status: "active" };
const inactiveVendor: VendorLifecycleRef = { ...activeVendor, status: "inactive" };

const fakeStore = (
  overrides: Partial<VendorLifecycleStore> = {},
  vendor: VendorLifecycleRef | null = activeVendor,
): VendorLifecycleStore & { calls: string[] } => {
  const calls: string[] = [];
  return {
    calls,
    getVendor: overrides.getVendor ?? (async () => vendor),
    deactivate:
      overrides.deactivate ??
      (async (_ctx, _v, reason): Promise<DeactivateOutcome> => {
        calls.push(`deactivate:${reason}`);
        return { ok: true };
      }),
    reactivate:
      overrides.reactivate ??
      (async (): Promise<ReactivateOutcome> => {
        calls.push("reactivate");
        // No lead on step 1 → the route's `step_assigned` notification has nobody to address and does
        // nothing, keeping this DB-free test off the notification path.
        return {
          ok: true,
          requestId: REQUEST,
          assignment: { assigneeUserId: null, roleNameId: null, roleNameEn: null },
        };
      }),
  };
};

/** Mounted exactly as `index.ts` does — the staff-only guard is middleware, so it must be in the test. */
const mount = (actor: () => Actor | null, store: VendorLifecycleStore) => {
  const app = new Hono<AppEnv>();
  app.use("*", requestContext(actor));
  const internalOnly = requireInternalActor();
  app.use("/vendors/:vendorId/deactivate", internalOnly);
  app.use("/vendors/:vendorId/reactivate", internalOnly);
  app.route("/vendors", vendorLifecycleRoutes(store));
  return app;
};

const deactivate = (app: Hono<AppEnv>, body: unknown = { reason: "Dormant since 2026" }) =>
  app.request(`/vendors/${VENDOR}/deactivate`, json(body));
const reactivate = (app: Hono<AppEnv>) => app.request(`/vendors/${VENDOR}/reactivate`, json({}));

describe("RBAC — the verb asymmetry (ADR-0009)", () => {
  test("anonymous → 401 on both paths", async () => {
    expect((await deactivate(mount(() => null, fakeStore()))).status).toBe(401);
    expect((await reactivate(mount(() => null, fakeStore(undefined, inactiveVendor)))).status).toBe(
      401,
    );
  });

  test("deactivate needs `vendors:delete` — the AP chain's `edit` is not enough", async () => {
    const store = fakeStore();
    const res = await deactivate(mount(apStaff, store));
    expect(res.status).toBe(403);
    expect(store.calls).toEqual([]);
  });

  test("the sysadmin, who holds `vendors:delete`, may deactivate", async () => {
    const store = fakeStore();
    expect((await deactivate(mount(sysadmin, store))).status).toBe(200);
    expect(store.calls).toEqual(["deactivate:Dormant since 2026"]);
  });

  test("raising a reactivation needs only `vendors:edit`, so the AP chain may raise it", async () => {
    const store = fakeStore(undefined, inactiveVendor);
    const res = await reactivate(mount(apStaff, store));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ requestId: REQUEST });
    expect(store.calls).toEqual(["reactivate"]);
  });

  test("a `view`-only actor may do neither", async () => {
    const viewer = () => actorWith(["view"]);
    expect((await deactivate(mount(viewer, fakeStore()))).status).toBe(403);
    expect((await reactivate(mount(viewer, fakeStore(undefined, inactiveVendor)))).status).toBe(
      403,
    );
  });
});

describe("staff-only — owning the record is the wrong warrant", () => {
  test("a vendor-kind actor holding the grants still can't deactivate itself", async () => {
    const owner = () => actorWith(["delete", "edit", "view"], "vendor");
    const store = fakeStore();
    const res = await deactivate(mount(owner, store));
    expect(res.status).toBe(403);
    expect(store.calls).toEqual([]);
  });

  test("nor can it vote itself back into service", async () => {
    const owner = () => actorWith(["delete", "edit", "view"], "vendor");
    const store = fakeStore(undefined, inactiveVendor);
    const res = await reactivate(mount(owner, store));
    expect(res.status).toBe(403);
    expect(store.calls).toEqual([]);
  });
});

describe("state gates", () => {
  test("deactivating a vendor that isn't Active → 409", async () => {
    for (const status of ["draft", "pending", "inactive", "blacklisted"] as const) {
      const store = fakeStore(undefined, { ...activeVendor, status });
      const res = await deactivate(mount(sysadmin, store));
      expect(res.status).toBe(409);
      expect(store.calls).toEqual([]);
    }
  });

  test("raising a reactivation for a vendor that isn't Inactive → 409", async () => {
    for (const status of ["draft", "pending", "active", "blacklisted"] as const) {
      const store = fakeStore(undefined, { ...activeVendor, status });
      const res = await reactivate(mount(apStaff, store));
      expect(res.status).toBe(409);
      expect(store.calls).toEqual([]);
    }
  });

  test("an unknown vendor → 404 on both", async () => {
    expect((await deactivate(mount(sysadmin, fakeStore(undefined, null)))).status).toBe(404);
    expect((await reactivate(mount(apStaff, fakeStore(undefined, null)))).status).toBe(404);
  });
});

describe("deactivate — the reason is mandatory", () => {
  test("a missing, empty, or whitespace-only reason → 422, nothing written", async () => {
    for (const body of [{}, { reason: "" }, { reason: "   " }]) {
      const store = fakeStore();
      const res = await deactivate(mount(sysadmin, store), body);
      expect(res.status).toBe(422);
      expect(store.calls).toEqual([]);
    }
  });

  test("the reason is trimmed before it reaches the store", async () => {
    const store = fakeStore();
    await deactivate(mount(sysadmin, store), { reason: "  Contract concluded  " });
    expect(store.calls).toEqual(["deactivate:Contract concluded"]);
  });
});

describe("in-flight approval requests (ADR-0010)", () => {
  test("deactivating under an open request → 409", async () => {
    const store = fakeStore({ deactivate: async () => ({ ok: false, reason: "request_pending" }) });
    expect((await deactivate(mount(sysadmin, store))).status).toBe(409);
  });

  test("a second reactivation raise trips the one-pending lock → 409", async () => {
    const store = fakeStore(
      { reactivate: async () => ({ ok: false, reason: "request_pending" }) },
      inactiveVendor,
    );
    expect((await reactivate(mount(apStaff, store))).status).toBe(409);
  });
});
