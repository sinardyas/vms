/**
 * Access-admin route (M1.5, #24) — `/console/access/*`. Run with `bun test`.
 *
 * Drives the router through a real Hono app with an injected actor resolver and a fake store, so the
 * orchestration is checked without Postgres or better-auth: every mutation is gated on the right
 * `access` verb (401 anonymous / 403 unpermitted), a malformed body is a 400, a code/email clash is a
 * 409, and — the milestone's point — a stranded critical capability comes back as a re-confirmable
 * 422 deadlock warning rather than a silent save.
 */

import { describe, expect, test } from "bun:test";
import { type Actor, toPermissionSet } from "@vms/domain";
import { Hono } from "hono";
import { type AccessStore, type MutationResult, accessRoutes } from "./access-route";
import { type RoleDTO, type UserDTO, emptyMatrix } from "./access-service";
import { type AppEnv, requestContext } from "./context";

const staff = (verbs: readonly ("view" | "add" | "edit" | "delete")[]): Actor => ({
  userId: "admin-1",
  kind: "internal",
  email: "admin@soechi.id",
  name: "Admin",
  permissions: toPermissionSet(verbs.map((verb) => ({ module: "access" as const, verb }))),
});

const aRole: RoleDTO = {
  id: "11111111-1111-4111-8111-111111111111",
  code: "document_verifier",
  nameId: "Verifikator",
  nameEn: "Verifier",
  active: true,
  leadUserId: null,
  userCount: 2,
  matrix: emptyMatrix(),
};

const aUser: UserDTO = {
  id: "22222222-2222-4222-8222-222222222222",
  email: "new@soechi.id",
  name: "New Staff",
  kind: "internal",
  active: true,
  roles: [],
};

/** A store whose behaviour each test overrides; unspecified methods throw if unexpectedly called. */
const fakeStore = (over: Partial<AccessStore> = {}): AccessStore => ({
  listRoles: async () => [aRole],
  createRole: async () => ({ ok: true, value: aRole }),
  updateRole: async () => ({ ok: true, value: aRole }),
  deactivateRole: async () => ({ ok: true, value: { ...aRole, active: false } }),
  listUsers: async () => [aUser],
  createUser: async () => ({ ok: true, value: aUser }),
  updateUser: async () => ({ ok: true, value: aUser }),
  resetPassword: async () => ({ email: aUser.email }),
  eligibility: async () => [
    { module: "approvals", verb: "approve", holders: 1 },
    { module: "documents", verb: "approve", holders: 1 },
  ],
  ...over,
});

const appWith = (resolveActor: () => Actor | null, store: AccessStore = fakeStore()) => {
  const app = new Hono<AppEnv>();
  app.use("*", requestContext(resolveActor));
  app.route("/console/access", accessRoutes(store));
  return app;
};

const validMatrixBody = { code: "r_new", nameId: "Peran", nameEn: "Role", matrix: emptyMatrix() };

describe("guards — every route gates on the access module", () => {
  test("401 when anonymous", async () => {
    const res = await appWith(() => null).request("/console/access/roles");
    expect(res.status).toBe(401);
    expect((await res.json()).error.messageKey).toBe("error.unauthorized");
  });

  test("403 when the actor lacks access:view", async () => {
    const res = await appWith(() => staff([])).request("/console/access/roles");
    expect(res.status).toBe(403);
  });

  test("403 on create without access:add (having only view)", async () => {
    const res = await appWith(() => staff(["view"])).request("/console/access/roles", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(validMatrixBody),
    });
    expect(res.status).toBe(403);
  });

  test("view grants read but not mutation", async () => {
    const res = await appWith(() => staff(["view"])).request("/console/access/roles");
    expect(res.status).toBe(200);
    expect((await res.json()).roles).toHaveLength(1);
  });
});

describe("roles", () => {
  test("POST creates a role (201) with add", async () => {
    const res = await appWith(() => staff(["add"])).request("/console/access/roles", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(validMatrixBody),
    });
    expect(res.status).toBe(201);
    expect((await res.json()).role.code).toBe("document_verifier");
  });

  test("POST with a bad body is a 400 validation error", async () => {
    const res = await appWith(() => staff(["add"])).request("/console/access/roles", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code: "BAD CODE", nameId: "", nameEn: "", matrix: {} }),
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("validation");
  });

  test("POST with a duplicate code is a 409", async () => {
    const store = fakeStore({ createRole: async () => ({ ok: false, conflict: true }) });
    const res = await appWith(() => staff(["add"]), store).request("/console/access/roles", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(validMatrixBody),
    });
    expect(res.status).toBe(409);
    expect((await res.json()).error.messageKey).toBe("access.error.codeTaken");
  });

  test("PATCH a missing role is a 404", async () => {
    const store = fakeStore({ updateRole: async () => null });
    const res = await appWith(() => staff(["edit"]), store).request(
      `/console/access/roles/${aRole.id}`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ nameEn: "Renamed" }),
      },
    );
    expect(res.status).toBe(404);
  });

  test("PATCH that strands a critical capability is a 422 deadlock warning naming the caps", async () => {
    const deadlock: MutationResult<RoleDTO> = {
      ok: false,
      deadlock: [{ module: "approvals", verb: "approve" }],
    };
    const store = fakeStore({ updateRole: async () => deadlock });
    const res = await appWith(() => staff(["edit"]), store).request(
      `/console/access/roles/${aRole.id}`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ matrix: emptyMatrix() }),
      },
    );
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error.messageKey).toBe("access.deadlock.warning");
    expect(body.error.params.capabilities).toBe("approvals:approve");
  });

  test("DELETE deactivates the role (needs access:delete)", async () => {
    const res = await appWith(() => staff(["delete"])).request(
      `/console/access/roles/${aRole.id}`,
      {
        method: "DELETE",
      },
    );
    expect(res.status).toBe(200);
    expect((await res.json()).role.active).toBe(false);
  });
});

describe("users", () => {
  test("POST creates an internal user (201)", async () => {
    const res = await appWith(() => staff(["add"])).request("/console/access/users", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "New@Soechi.ID", name: "New Staff", roleIds: [] }),
    });
    expect(res.status).toBe(201);
    expect((await res.json()).user.kind).toBe("internal");
  });

  test("POST with an existing email is a 409", async () => {
    const store = fakeStore({ createUser: async () => ({ ok: false, conflict: true }) });
    const res = await appWith(() => staff(["add"]), store).request("/console/access/users", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "dupe@soechi.id", name: "Dupe" }),
    });
    expect(res.status).toBe(409);
    expect((await res.json()).error.messageKey).toBe("access.error.emailTaken");
  });

  test("PATCH granting roles to a vendor-kind user is a 422 (#96)", async () => {
    const store = fakeStore({ updateUser: async () => ({ ok: false, vendorGrant: true }) });
    const res = await appWith(() => staff(["edit"]), store).request(
      `/console/access/users/${aUser.id}`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ roleIds: [aRole.id] }),
      },
    );
    expect(res.status).toBe(422);
    expect((await res.json()).error.messageKey).toBe("access.error.vendorRoleGrant");
  });

  test("PATCH clearing a vendor-kind user's roles is refused too (#96)", async () => {
    const store = fakeStore({ updateUser: async () => ({ ok: false, vendorGrant: true }) });
    const res = await appWith(() => staff(["edit"]), store).request(
      `/console/access/users/${aUser.id}`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ roleIds: [] }),
      },
    );
    expect(res.status).toBe(422);
    expect((await res.json()).error.messageKey).toBe("access.error.vendorRoleGrant");
  });

  test("PATCH granting roles to an internal user is unaffected", async () => {
    const granted: UserDTO = { ...aUser, roles: [aRole] };
    const store = fakeStore({ updateUser: async () => ({ ok: true, value: granted }) });
    const res = await appWith(() => staff(["edit"]), store).request(
      `/console/access/users/${aUser.id}`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ roleIds: [aRole.id] }),
      },
    );
    expect(res.status).toBe(200);
    expect((await res.json()).user.roles).toHaveLength(1);
  });

  test("reset-password needs access:edit and returns the target email", async () => {
    const res = await appWith(() => staff(["edit"])).request(
      `/console/access/users/${aUser.id}/reset-password`,
      { method: "POST" },
    );
    expect(res.status).toBe(200);
    expect((await res.json()).email).toBe(aUser.email);
  });

  test("reset-password on a missing user is a 404", async () => {
    const store = fakeStore({ resetPassword: async () => null });
    const res = await appWith(() => staff(["edit"]), store).request(
      `/console/access/users/${aUser.id}/reset-password`,
      { method: "POST" },
    );
    expect(res.status).toBe(404);
  });

  test("PATCH that strands a critical capability (deactivating the last approver) is a 422", async () => {
    const store = fakeStore({
      updateUser: async () => ({ ok: false, deadlock: [{ module: "documents", verb: "approve" }] }),
    });
    const res = await appWith(() => staff(["edit"]), store).request(
      `/console/access/users/${aUser.id}`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ active: false }),
      },
    );
    expect(res.status).toBe(422);
    expect((await res.json()).error.params.capabilities).toBe("documents:approve");
  });
});

describe("eligibility", () => {
  test("GET returns the critical-capability holder counts (needs access:view)", async () => {
    const res = await appWith(() => staff(["view"])).request("/console/access/eligibility");
    expect(res.status).toBe(200);
    const { critical } = await res.json();
    expect(critical).toHaveLength(2);
    expect(critical[0]).toMatchObject({ module: "approvals", verb: "approve", holders: 1 });
  });
});
