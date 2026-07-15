/**
 * Registration lists (M2.2, #33) — the five masters wired to the M2.1 framework. Run with `bun test`.
 *
 * The generic route + store mechanics are covered by `master-list.test.ts`; here we check the M2.2
 * *instantiation*: every list mounts at its own path under the `registration_lists` guard (an
 * anonymous call to each is a 401, proving the mount + guard without a database), and each list's own
 * Zod schema accepts a well-formed body and rejects a list-specific malformation (a bad locality, a
 * wrong-length ISO code, a missing bilingual side). The real stores need Postgres, so those are
 * exercised live under Docker in the delivery notes, not here — this stays DB-free with a fake store.
 */

import { describe, expect, test } from "bun:test";
import { type Actor, toPermissionSet } from "@vms/domain";
import { Hono } from "hono";
import type { ZodType } from "zod";
import { type AppEnv, requestContext } from "./context";
import { type Created, type MasterDTO, type MasterStore, masterListRoutes } from "./master-list";
import {
  bankCreate,
  businessEntityCreate,
  countryCreate,
  currencyCreate,
  registrationListRoutes,
  vendorCategoryCreate,
} from "./registration-lists-route";

/** A staff actor holding the given verbs on `registration_lists` (the module every list gates on). */
const staff = (verbs: readonly ("view" | "add" | "edit" | "delete")[]): Actor => ({
  userId: "admin-1",
  kind: "internal",
  email: "admin@soechi.id",
  name: "Admin",
  permissions: toPermissionSet(
    verbs.map((verb) => ({ module: "registration_lists" as const, verb })),
  ),
});

const aRow: MasterDTO = { id: "11111111-1111-4111-8111-111111111111", active: true };

/** A permissive fake store — every method resolves; the schema, not the store, is under test here. */
const fakeStore = (): MasterStore<unknown, unknown, MasterDTO> => ({
  list: async () => [aRow],
  create: async (): Promise<Created<MasterDTO>> => ({ ok: true, value: aRow }),
  update: async () => aRow,
  setActive: async (_ctx, _id, active) => ({ ...aRow, active }),
});

const post = (body: unknown): RequestInit => ({
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

/** Mount one list's real create schema behind the framework with a fake store + the given actor. */
const listApp = (createSchema: ZodType<unknown>, actor: () => Actor | null) => {
  const app = new Hono<AppEnv>();
  app.use("*", requestContext(actor));
  app.route(
    "/list",
    masterListRoutes({
      module: "registration_lists",
      createSchema,
      updateSchema: createSchema,
      store: fakeStore(),
    }),
  );
  return app;
};

describe("mount + guard — all five lists are mounted under the registration_lists guard", () => {
  // An anonymous GET hits the guard before any store call, so it proves the path is mounted without
  // needing Postgres. Every registration-list path must answer 401 (deny-by-default).
  const paths = ["/business-entities", "/vendor-categories", "/banks", "/currencies", "/countries"];
  const anon = new Hono<AppEnv>();
  anon.use(
    "*",
    requestContext(() => null),
  );
  anon.route("/console/registration-lists", registrationListRoutes());

  for (const path of paths) {
    test(`GET ${path} → 401 when anonymous`, async () => {
      const res = await anon.request(`/console/registration-lists${path}`);
      expect(res.status).toBe(401);
      expect((await res.json()).error.messageKey).toBe("error.unauthorized");
    });
  }
});

describe("business_entities — bilingual term + Local/Foreign locality", () => {
  test("201 on a well-formed body", async () => {
    const res = await listApp(businessEntityCreate, () => staff(["add"])).request(
      "/list",
      post({ nameId: "Perseroan Terbatas", nameEn: "Limited Company", category: "local" }),
    );
    expect(res.status).toBe(201);
  });
  test("400 when category is not a locality", async () => {
    const res = await listApp(businessEntityCreate, () => staff(["add"])).request(
      "/list",
      post({ nameId: "X", nameEn: "Y", category: "regional" }),
    );
    expect(res.status).toBe(400);
  });
  test("400 when a bilingual side is blank", async () => {
    const res = await listApp(businessEntityCreate, () => staff(["add"])).request(
      "/list",
      post({ nameId: "", nameEn: "Y", category: "local" }),
    );
    expect(res.status).toBe(400);
  });
});

describe("vendor_categories — bilingual term only", () => {
  test("201 on a well-formed body", async () => {
    const res = await listApp(vendorCategoryCreate, () => staff(["add"])).request(
      "/list",
      post({ nameId: "Bahan Bakar", nameEn: "Fuel" }),
    );
    expect(res.status).toBe(201);
  });
  test("400 when a side is missing", async () => {
    const res = await listApp(vendorCategoryCreate, () => staff(["add"])).request(
      "/list",
      post({ nameId: "Bahan Bakar" }),
    );
    expect(res.status).toBe(400);
  });
});

describe("countries — single name + ISO-3", () => {
  test("201 on a valid ISO-3 (lower-case is upper-cased)", async () => {
    const res = await listApp(countryCreate, () => staff(["add"])).request(
      "/list",
      post({ name: "Indonesia", iso3: "idn" }),
    );
    expect(res.status).toBe(201);
  });
  test("400 when iso3 is not exactly three chars", async () => {
    const res = await listApp(countryCreate, () => staff(["add"])).request(
      "/list",
      post({ name: "Indonesia", iso3: "ID" }),
    );
    expect(res.status).toBe(400);
  });
});

describe("currencies — code + name + bank-selector flag", () => {
  test("201 on a valid ISO-4217 code", async () => {
    const res = await listApp(currencyCreate, () => staff(["add"])).request(
      "/list",
      post({ code: "CNY", name: "Renminbi", country: "China", showInBankSelector: true }),
    );
    expect(res.status).toBe(201);
  });
  test("400 when the code is not three chars", async () => {
    const res = await listApp(currencyCreate, () => staff(["add"])).request(
      "/list",
      post({ code: "US", name: "US Dollar" }),
    );
    expect(res.status).toBe(400);
  });
});

describe("banks — single name + code + locality + optional country FK", () => {
  test("201 without a country (nullable FK)", async () => {
    const res = await listApp(bankCreate, () => staff(["add"])).request(
      "/list",
      post({ name: "Bank Mandiri", code: "BMRI", location: "local" }),
    );
    expect(res.status).toBe(201);
  });
  test("400 when location is not a locality", async () => {
    const res = await listApp(bankCreate, () => staff(["add"])).request(
      "/list",
      post({ name: "Bank Mandiri", code: "BMRI", location: "offshore" }),
    );
    expect(res.status).toBe(400);
  });
});
