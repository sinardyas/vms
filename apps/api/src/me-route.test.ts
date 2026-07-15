/**
 * Session identity + capability mirror (M1.3, #22) — `GET /me`. Run with `bun test`.
 *
 * Drives the route through a real Hono app with an injected actor resolver, so the mirror contract is
 * checked without a live session: an anonymous caller is refused, and an authenticated one gets back a
 * capability grid that matches its grants exactly — true only where a grant exists, false everywhere
 * else. That equality is the whole point: the UI reads this grid, the guard reads the same set.
 */

import { describe, expect, test } from "bun:test";
import { type Actor, toPermissionSet } from "@vms/domain";
import { Hono } from "hono";
import { type AppEnv, requestContext } from "./context";
import { meRoutes } from "./me-route";

const staff = (permissions: Actor["permissions"]): Actor => ({
  userId: "user-1",
  kind: "internal",
  email: "staff@soechi.id",
  name: "Staff",
  permissions,
});

/** Mount the route under a parent running the context middleware — the real wiring. */
const appWith = (resolveActor: () => Actor | null) => {
  const app = new Hono<AppEnv>();
  app.use("*", requestContext(resolveActor));
  app.route("/", meRoutes());
  return app;
};

describe("GET /me", () => {
  test("401 when unauthenticated — the same signal a guarded route gives an anonymous caller", async () => {
    const res = await appWith(() => null).request("/me");
    expect(res.status).toBe(401);
    expect((await res.json()).error.messageKey).toBe("error.unauthorized");
  });

  test("returns identity but never the raw permission set", async () => {
    const actor = () => staff(toPermissionSet([{ module: "audit", verb: "view" }]));
    const res = await appWith(actor).request("/me");

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.actor).toEqual({
      userId: "user-1",
      kind: "internal",
      email: "staff@soechi.id",
      name: "Staff",
    });
    expect(body.actor.permissions).toBeUndefined();
  });

  test("capability grid mirrors the actor's grants — true only where granted, false everywhere else", async () => {
    // A scoped actor: may view + edit vendors, view audit; nothing else.
    const actor = () =>
      staff(
        toPermissionSet([
          { module: "vendors", verb: "view" },
          { module: "vendors", verb: "edit" },
          { module: "audit", verb: "view" },
        ]),
      );
    const res = await appWith(actor).request("/me");
    const { capabilities } = await res.json();

    // Granted pairs are true…
    expect(capabilities.vendors.view).toBe(true);
    expect(capabilities.vendors.edit).toBe(true);
    expect(capabilities.audit.view).toBe(true);

    // …and everything else — an ungranted verb on a granted module, and a wholly ungranted module —
    // is false. Deny-by-default: a hidden button is exactly a request the guard would refuse.
    expect(capabilities.vendors.delete).toBe(false);
    expect(capabilities.vendors.approve).toBe(false);
    expect(capabilities.audit.edit).toBe(false);
    expect(capabilities.access.view).toBe(false);
    expect(capabilities.approvals.approve).toBe(false);
  });

  test("emits the full 9×5 grid so the UI can read any (module, verb) without a lookup miss", async () => {
    const res = await appWith(() => staff(toPermissionSet([]))).request("/me");
    const { capabilities } = await res.json();

    const modules = Object.keys(capabilities);
    expect(modules).toHaveLength(9);
    for (const module of modules) {
      expect(Object.keys(capabilities[module])).toHaveLength(5);
      // A grant-less actor's grid is all-false — deny-by-default, in full.
      for (const allowed of Object.values(capabilities[module])) expect(allowed).toBe(false);
    }
  });
});
