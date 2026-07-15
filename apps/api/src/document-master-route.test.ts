/**
 * Document Master + category-requirements matrix (M2.3, #34) — the compliance doc list wired to the
 * M2.1 framework plus the bespoke M:N matrix. Run with `bun test`.
 *
 * The generic list mechanics are covered by `master-list.test.ts`; here we check the M2.3 specifics
 * without a database: every path mounts under the `document_master` guard (anonymous → 401), the
 * document create schema accepts a well-formed body and rejects the doc-specific malformations (a bad
 * `applies_to`, a missing `no`, a blank bilingual side), and the requirements sub-router drives its
 * injectable store correctly (guarded set / list / soft-delete, 404 when a cell was never a
 * requirement). The real stores need Postgres, so those are exercised live under Docker in the
 * delivery notes, not here.
 */

import { describe, expect, test } from "bun:test";
import { type Actor, type RequestContext, toPermissionSet } from "@vms/domain";
import { Hono } from "hono";
import { type AppEnv, requestContext } from "./context";
import {
  type RequirementDTO,
  type RequirementStore,
  documentMasterCreate,
  documentMasterRoutes,
  requirementRoutes,
} from "./document-master-route";
import { type Created, type MasterDTO, type MasterStore, masterListRoutes } from "./master-list";

/** A staff actor holding the given verbs on `document_master` (the module the whole screen gates on). */
const staff = (verbs: readonly ("view" | "add" | "edit" | "delete")[]): Actor => ({
  userId: "admin-1",
  kind: "internal",
  email: "admin@soechi.id",
  name: "Admin",
  permissions: toPermissionSet(verbs.map((verb) => ({ module: "document_master" as const, verb }))),
});

const post = (body: unknown): RequestInit => ({
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});
const put = (body: unknown): RequestInit => ({
  method: "PUT",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

const aRow: MasterDTO = { id: "11111111-1111-4111-8111-111111111111", active: true };
const fakeMasterStore = (): MasterStore<unknown, unknown, MasterDTO> => ({
  list: async () => [aRow],
  create: async (): Promise<Created<MasterDTO>> => ({ ok: true, value: aRow }),
  update: async () => aRow,
  setActive: async (_ctx, _id, active) => ({ ...aRow, active }),
});

/** Mount the document create schema behind the framework with a fake store + the given actor. */
const docApp = (actor: () => Actor | null) => {
  const app = new Hono<AppEnv>();
  app.use("*", requestContext(actor));
  app.route(
    "/list",
    masterListRoutes({
      module: "document_master",
      createSchema: documentMasterCreate,
      updateSchema: documentMasterCreate,
      store: fakeMasterStore(),
    }),
  );
  return app;
};

const CAT = "22222222-2222-4222-8222-222222222222";
const DOC = "33333333-3333-4333-8333-333333333333";
const aReq: RequirementDTO = { id: "r1", categoryId: CAT, documentMasterId: DOC, mandatory: true };

/** A configurable fake requirement store — records calls so the router's behaviour can be asserted. */
const fakeReqStore = (
  overrides: Partial<RequirementStore> = {},
): RequirementStore & { calls: string[] } => {
  const calls: string[] = [];
  return {
    calls,
    list: overrides.list ?? (async () => [aReq]),
    set:
      overrides.set ??
      (async (_ctx: RequestContext, input) => {
        calls.push(`set:${input.categoryId}:${input.documentMasterId}:${input.mandatory}`);
        return { ...aReq, mandatory: input.mandatory ?? true };
      }),
    remove:
      overrides.remove ??
      (async (_ctx: RequestContext, categoryId, documentMasterId) => {
        calls.push(`remove:${categoryId}:${documentMasterId}`);
        return aReq;
      }),
  };
};

const reqApp = (actor: () => Actor | null, store: RequirementStore) => {
  const app = new Hono<AppEnv>();
  app.use("*", requestContext(actor));
  app.route("/requirements", requirementRoutes(store));
  return app;
};

describe("mount + guard — the whole screen is under the document_master guard", () => {
  const anon = new Hono<AppEnv>();
  anon.use(
    "*",
    requestContext(() => null),
  );
  anon.route("/console/document-master", documentMasterRoutes());

  // The document list mounts at the bare prefix (the console client calls it without a trailing slash);
  // the matrix at `/requirements`. An anonymous GET hits the guard before any store call → 401.
  for (const path of ["", "/requirements"]) {
    test(`GET ${path || "(root)"} → 401 when anonymous`, async () => {
      const res = await anon.request(`/console/document-master${path}`);
      expect(res.status).toBe(401);
      expect((await res.json()).error.messageKey).toBe("error.unauthorized");
    });
  }
});

describe("document create schema — bilingual + origin applies_to + create-only no", () => {
  const good = {
    no: "DOC-021",
    nameId: "Sertifikat Baru",
    nameEn: "New Certificate",
    type: "Legal",
    appliesTo: "both",
    validityDays: 365,
    mandatory: true,
    reminder: "1 month",
  };

  test("201 on a well-formed body", async () => {
    const res = await docApp(() => staff(["add"])).request("/list", post(good));
    expect(res.status).toBe(201);
  });
  test("201 with only the required fields (validity/mandatory/reminder default)", async () => {
    const res = await docApp(() => staff(["add"])).request(
      "/list",
      post({ no: "DOC-022", nameId: "X", nameEn: "Y", type: "Tax", appliesTo: "local" }),
    );
    expect(res.status).toBe(201);
  });
  test("400 when appliesTo is not a valid origin", async () => {
    const res = await docApp(() => staff(["add"])).request(
      "/list",
      post({ ...good, appliesTo: "regional" }),
    );
    expect(res.status).toBe(400);
  });
  test("400 when the create-only `no` is missing", async () => {
    const { no: _drop, ...noNo } = good;
    const res = await docApp(() => staff(["add"])).request("/list", post(noNo));
    expect(res.status).toBe(400);
  });
  test("400 when a bilingual side is blank", async () => {
    const res = await docApp(() => staff(["add"])).request("/list", post({ ...good, nameEn: "" }));
    expect(res.status).toBe(400);
  });
});

describe("requirements matrix — the M:N sub-router over its store", () => {
  test("GET /requirements → 401 anonymous, 200 with view", async () => {
    const anon = reqApp(() => null, fakeReqStore());
    expect((await anon.request("/requirements")).status).toBe(401);

    const ok = reqApp(() => staff(["view"]), fakeReqStore());
    const res = await ok.request("/requirements");
    expect(res.status).toBe(200);
    expect((await res.json()).items).toHaveLength(1);
  });

  test("PUT /requirements → 403 without edit, 200 + store.set with edit", async () => {
    const denied = reqApp(() => staff(["view"]), fakeReqStore());
    expect(
      (await denied.request("/requirements", put({ categoryId: CAT, documentMasterId: DOC })))
        .status,
    ).toBe(403);

    const store = fakeReqStore();
    const ok = reqApp(() => staff(["edit"]), store);
    const res = await ok.request(
      "/requirements",
      put({ categoryId: CAT, documentMasterId: DOC, mandatory: false }),
    );
    expect(res.status).toBe(200);
    expect(store.calls).toContain(`set:${CAT}:${DOC}:false`);
  });

  test("PUT /requirements → 400 on a non-uuid id", async () => {
    const ok = reqApp(() => staff(["edit"]), fakeReqStore());
    const res = await ok.request(
      "/requirements",
      put({ categoryId: "not-a-uuid", documentMasterId: DOC }),
    );
    expect(res.status).toBe(400);
  });

  test("DELETE /requirements/:cat/:doc → 200 when the cell existed", async () => {
    const store = fakeReqStore();
    const ok = reqApp(() => staff(["delete"]), store);
    const res = await ok.request(`/requirements/${CAT}/${DOC}`, { method: "DELETE" });
    expect(res.status).toBe(200);
    expect(store.calls).toContain(`remove:${CAT}:${DOC}`);
  });

  test("DELETE /requirements/:cat/:doc → 404 when the cell was never a requirement", async () => {
    const store = fakeReqStore({ remove: async () => null });
    const ok = reqApp(() => staff(["delete"]), store);
    const res = await ok.request(`/requirements/${CAT}/${DOC}`, { method: "DELETE" });
    expect(res.status).toBe(404);
    expect((await res.json()).error.messageKey).toBe("error.notFound");
  });

  test("DELETE /requirements/:cat/:doc → 403 without delete", async () => {
    const ok = reqApp(() => staff(["edit"]), fakeReqStore());
    const res = await ok.request(`/requirements/${CAT}/${DOC}`, { method: "DELETE" });
    expect(res.status).toBe(403);
  });
});
