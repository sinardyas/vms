/**
 * Operational lists (M2.5, #36) — the six masters wired to the M2.1 framework. Run with `bun test`.
 *
 * The generic route + store mechanics are covered by `master-list.test.ts`; here we check the M2.5
 * *instantiation*: every list mounts at its own path under the `operational_lists` guard (an anonymous
 * call to each is a 401, proving the mount + guard without a database), and each list's own Zod schema
 * accepts a well-formed body and rejects a list-specific malformation (a bad `applies_to`, an
 * over-length code, a missing bilingual side). The real stores need Postgres, so those are exercised
 * live under Docker in the delivery notes, not here — this stays DB-free with a fake store.
 */

import { describe, expect, test } from "bun:test";
import { type Actor, toPermissionSet } from "@vms/domain";
import { Hono } from "hono";
import type { ZodType } from "zod";
import { type AppEnv, requestContext } from "./context";
import { type Created, type MasterDTO, type MasterStore, masterListRoutes } from "./master-list";
import {
  departmentCreate,
  operationalListRoutes,
  portCreate,
  slaThresholdCreate,
  soechiEntityCreate,
  taxCodeCreate,
  vesselCreate,
} from "./operational-lists-route";

/** A staff actor holding the given verbs on `operational_lists` (the module every list gates on). */
const staff = (verbs: readonly ("view" | "add" | "edit" | "delete")[]): Actor => ({
  userId: "admin-1",
  kind: "internal",
  email: "admin@soechi.id",
  name: "Admin",
  permissions: toPermissionSet(
    verbs.map((verb) => ({ module: "operational_lists" as const, verb })),
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
      module: "operational_lists",
      createSchema,
      updateSchema: createSchema,
      store: fakeStore(),
    }),
  );
  return app;
};

describe("mount + guard — all six lists are mounted under the operational_lists guard", () => {
  // An anonymous GET hits the guard before any store call, so it proves the path is mounted without
  // needing Postgres. Every operational-list path must answer 401 (deny-by-default).
  const paths = [
    "/departments",
    "/soechi-entities",
    "/vessels",
    "/ports",
    "/tax-codes",
    "/sla-thresholds",
  ];
  const anon = new Hono<AppEnv>();
  anon.use(
    "*",
    requestContext(() => null),
  );
  anon.route("/console/operational-lists", operationalListRoutes());

  for (const path of paths) {
    test(`GET ${path} → 401 when anonymous`, async () => {
      const res = await anon.request(`/console/operational-lists${path}`);
      expect(res.status).toBe(401);
      expect((await res.json()).error.messageKey).toBe("error.unauthorized");
    });
  }
});

describe("departments — code (create-only) + bilingual term", () => {
  test("201 on a well-formed body", async () => {
    const res = await listApp(departmentCreate, () => staff(["add"])).request(
      "/list",
      post({ code: "FIN", nameId: "Keuangan", nameEn: "Finance" }),
    );
    expect(res.status).toBe(201);
  });
  test("400 when a bilingual side is blank", async () => {
    const res = await listApp(departmentCreate, () => staff(["add"])).request(
      "/list",
      post({ code: "FIN", nameId: "", nameEn: "Finance" }),
    );
    expect(res.status).toBe(400);
  });
  test("400 when the code is missing", async () => {
    const res = await listApp(departmentCreate, () => staff(["add"])).request(
      "/list",
      post({ nameId: "Keuangan", nameEn: "Finance" }),
    );
    expect(res.status).toBe(400);
  });
});

describe("soechi_entities — bilingual term only", () => {
  test("201 on a well-formed body", async () => {
    const res = await listApp(soechiEntityCreate, () => staff(["add"])).request(
      "/list",
      post({ nameId: "PT Soechi Lines Tbk", nameEn: "PT Soechi Lines Tbk" }),
    );
    expect(res.status).toBe(201);
  });
  test("400 when a side is missing", async () => {
    const res = await listApp(soechiEntityCreate, () => staff(["add"])).request(
      "/list",
      post({ nameEn: "PT Soechi Lines Tbk" }),
    );
    expect(res.status).toBe(400);
  });
});

describe("vessels — code + name + optional type", () => {
  test("201 without a type (nullable)", async () => {
    const res = await listApp(vesselCreate, () => staff(["add"])).request(
      "/list",
      post({ code: "MT-ASIA", name: "MT Soechi Asia" }),
    );
    expect(res.status).toBe(201);
  });
  test("400 when the name is blank", async () => {
    const res = await listApp(vesselCreate, () => staff(["add"])).request(
      "/list",
      post({ code: "MT-ASIA", name: "" }),
    );
    expect(res.status).toBe(400);
  });
});

describe("ports — code + name + optional country FK / tz / lat / lon", () => {
  test("201 without a country (nullable FK)", async () => {
    const res = await listApp(portCreate, () => staff(["add"])).request(
      "/list",
      post({ code: "IDTPP", name: "Tanjung Priok", tz: "UTC+7" }),
    );
    expect(res.status).toBe(201);
  });
  test("400 when countryId is not a UUID", async () => {
    const res = await listApp(portCreate, () => staff(["add"])).request(
      "/list",
      post({ code: "IDTPP", name: "Tanjung Priok", countryId: "not-a-uuid" }),
    );
    expect(res.status).toBe(400);
  });
});

describe("tax_codes — code + bilingual label + origin applicability", () => {
  test("201 on a valid applies_to", async () => {
    const res = await listApp(taxCodeCreate, () => staff(["add"])).request(
      "/list",
      post({
        code: "PPN",
        labelId: "Pajak Pertambahan Nilai",
        labelEn: "Value-Added Tax",
        rate: "11%",
        appliesTo: "both",
      }),
    );
    expect(res.status).toBe(201);
  });
  test("400 when applies_to is not a known origin", async () => {
    const res = await listApp(taxCodeCreate, () => staff(["add"])).request(
      "/list",
      post({ code: "PPN", labelId: "X", labelEn: "Y", appliesTo: "everywhere" }),
    );
    expect(res.status).toBe(400);
  });
});

describe("sla_thresholds — bilingual stage + email flag (inert config)", () => {
  test("201 on a well-formed body", async () => {
    const res = await listApp(slaThresholdCreate, () => staff(["add"])).request(
      "/list",
      post({
        stageId: "Verifikasi Dokumen",
        stageEn: "Document Verification",
        target: "2 business days",
        email: true,
      }),
    );
    expect(res.status).toBe(201);
  });
  test("400 when a stage side is blank", async () => {
    const res = await listApp(slaThresholdCreate, () => staff(["add"])).request(
      "/list",
      post({ stageId: "", stageEn: "Document Verification" }),
    );
    expect(res.status).toBe(400);
  });
});
