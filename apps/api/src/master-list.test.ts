/**
 * Master-list CRUD framework — the generic router (M2.1, #32). Run with `bun test`.
 *
 * Drives `masterListRoutes` through a real Hono app with an injected actor resolver and a fake store,
 * so the orchestration is checked without Postgres: every route gates on the list's RBAC module (401
 * anonymous / 403 unpermitted), a malformed body is a 400, a unique clash is a 409, a vanished row is
 * a 404, `?active=true` asks the store for capturable rows only, and DELETE is a **soft delete**
 * (setActive(false)) while POST `/:id/reactivate` is setActive(true) — the M2.1 DoD, list-agnostic.
 */

import { describe, expect, test } from "bun:test";
import { type Actor, toPermissionSet } from "@vms/domain";
import { Hono } from "hono";
import { z } from "zod";
import { type AppEnv, requestContext } from "./context";
import { type Created, type MasterDTO, type MasterStore, masterListRoutes } from "./master-list";

/** A minimal list DTO for the fixture — a bilingual-term master row (`registration_lists` module). */
type EntityDTO = MasterDTO & { readonly nameId: string; readonly nameEn: string };
type CreateInput = { readonly nameId: string; readonly nameEn: string };
type UpdateInput = { readonly nameId?: string; readonly nameEn?: string };

const aRow: EntityDTO = {
  id: "11111111-1111-4111-8111-111111111111",
  active: true,
  nameId: "Perseroan Terbatas",
  nameEn: "Limited Company",
};

/** A staff actor holding the given verbs on `registration_lists` (the fixture list's module). */
const staff = (verbs: readonly ("view" | "add" | "edit" | "delete")[]): Actor => ({
  userId: "admin-1",
  kind: "internal",
  email: "admin@soechi.id",
  name: "Admin",
  permissions: toPermissionSet(
    verbs.map((verb) => ({ module: "registration_lists" as const, verb })),
  ),
});

/** A record of the calls a test wants to assert on, filled by the fake store. */
type Calls = {
  list?: { capturableOnly: boolean };
  setActive?: { id: string; active: boolean };
};

/** A store whose behaviour each test overrides; unspecified methods return sensible defaults. */
const fakeStore = (
  over: Partial<MasterStore<CreateInput, UpdateInput, EntityDTO>> = {},
  calls: Calls = {},
): MasterStore<CreateInput, UpdateInput, EntityDTO> => ({
  list: async (opts) => {
    calls.list = opts;
    return [aRow];
  },
  create: async (): Promise<Created<EntityDTO>> => ({ ok: true, value: aRow }),
  update: async () => aRow,
  setActive: async (_ctx, id, active) => {
    calls.setActive = { id, active };
    return { ...aRow, active };
  },
  ...over,
});

const appWith = (
  resolveActor: () => Actor | null,
  store: MasterStore<CreateInput, UpdateInput, EntityDTO> = fakeStore(),
) => {
  const app = new Hono<AppEnv>();
  app.use("*", requestContext(resolveActor));
  app.route(
    "/lists/entities",
    masterListRoutes({
      module: "registration_lists",
      createSchema: entityCreate,
      updateSchema: entityUpdate,
      store,
    }),
  );
  return app;
};

// Schemas mirror what M2.2 composes from `bilingualLabelFields`, kept inline so the test is self-contained.
const entityCreate = z.object({
  nameId: z.string().trim().min(1),
  nameEn: z.string().trim().min(1),
});
const entityUpdate = z.object({
  nameId: z.string().trim().min(1).optional(),
  nameEn: z.string().trim().min(1).optional(),
});
const validBody = { nameId: "Firma", nameEn: "Firm" };

const req = (app: Hono<AppEnv>, path: string, init?: RequestInit) => app.request(path, init);
const post = (body: unknown): RequestInit => ({
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});
const patch = (body: unknown): RequestInit => ({ ...post(body), method: "PATCH" });

describe("guards — every route gates on the list's module", () => {
  test("401 when anonymous", async () => {
    const res = await req(
      appWith(() => null),
      "/lists/entities",
    );
    expect(res.status).toBe(401);
    expect((await res.json()).error.messageKey).toBe("error.unauthorized");
  });

  test("403 when the actor lacks the verb", async () => {
    const res = await req(
      appWith(() => staff([])),
      "/lists/entities",
    );
    expect(res.status).toBe(403);
  });

  test("each mutation needs its own verb", async () => {
    // Holds only `view` → create (add), update (edit), delete, reactivate (edit) all forbidden.
    const app = appWith(() => staff(["view"]));
    expect((await req(app, "/lists/entities", post(validBody))).status).toBe(403);
    expect((await req(app, `/lists/entities/${aRow.id}`, patch(validBody))).status).toBe(403);
    expect((await req(app, `/lists/entities/${aRow.id}`, { method: "DELETE" })).status).toBe(403);
    expect((await req(app, `/lists/entities/${aRow.id}/reactivate`, post({}))).status).toBe(403);
  });
});

describe("list — capturable filter (referential read split)", () => {
  test("plain list asks for every row", async () => {
    const calls: Calls = {};
    const res = await req(
      appWith(() => staff(["view"]), fakeStore({}, calls)),
      "/lists/entities",
    );
    expect(res.status).toBe(200);
    expect((await res.json()).items).toHaveLength(1);
    expect(calls.list).toEqual({ capturableOnly: false });
  });

  test("?active=true narrows to capturable rows only", async () => {
    const calls: Calls = {};
    await req(
      appWith(() => staff(["view"]), fakeStore({}, calls)),
      "/lists/entities?active=true",
    );
    expect(calls.list).toEqual({ capturableOnly: true });
  });
});

describe("create — validation + conflict", () => {
  test("201 with the created item", async () => {
    const res = await req(
      appWith(() => staff(["add"])),
      "/lists/entities",
      post(validBody),
    );
    expect(res.status).toBe(201);
    expect((await res.json()).item.id).toBe(aRow.id);
  });

  test("400 on a malformed body", async () => {
    const res = await req(
      appWith(() => staff(["add"])),
      "/lists/entities",
      post({ nameId: "" }),
    );
    expect(res.status).toBe(400);
  });

  test("409 on a unique clash, with the shared master key", async () => {
    const store = fakeStore({ create: async () => ({ ok: false, conflict: true }) });
    const res = await req(
      appWith(() => staff(["add"]), store),
      "/lists/entities",
      post(validBody),
    );
    expect(res.status).toBe(409);
    expect((await res.json()).error.messageKey).toBe("master.error.codeTaken");
  });
});

describe("update — 404 when gone", () => {
  test("200 with the updated item", async () => {
    const res = await req(
      appWith(() => staff(["edit"])),
      `/lists/entities/${aRow.id}`,
      patch({ nameEn: "Ltd." }),
    );
    expect(res.status).toBe(200);
  });

  test("404 when the store reports the row vanished", async () => {
    const store = fakeStore({ update: async () => null });
    const res = await req(
      appWith(() => staff(["edit"]), store),
      `/lists/entities/${aRow.id}`,
      patch({ nameEn: "Ltd." }),
    );
    expect(res.status).toBe(404);
    expect((await res.json()).error.messageKey).toBe("master.error.notFound");
  });
});

describe("soft delete + reactivate — never a hard delete", () => {
  test("DELETE deactivates (setActive false), 200 with active:false", async () => {
    const calls: Calls = {};
    const res = await req(
      appWith(() => staff(["delete"]), fakeStore({}, calls)),
      `/lists/entities/${aRow.id}`,
      { method: "DELETE" },
    );
    expect(res.status).toBe(200);
    expect((await res.json()).item.active).toBe(false);
    expect(calls.setActive).toEqual({ id: aRow.id, active: false });
  });

  test("reactivate sets active true", async () => {
    const calls: Calls = {};
    const res = await req(
      appWith(() => staff(["edit"]), fakeStore({}, calls)),
      `/lists/entities/${aRow.id}/reactivate`,
      post({}),
    );
    expect(res.status).toBe(200);
    expect((await res.json()).item.active).toBe(true);
    expect(calls.setActive).toEqual({ id: aRow.id, active: true });
  });

  test("404 when reactivating a row that vanished", async () => {
    const store = fakeStore({ setActive: async () => null });
    const res = await req(
      appWith(() => staff(["edit"]), store),
      `/lists/entities/${aRow.id}/reactivate`,
      post({}),
    );
    expect(res.status).toBe(404);
  });
});
