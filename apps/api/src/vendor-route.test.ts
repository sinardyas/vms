/**
 * Vendor aggregate route tests (M3.5, #46) — DB-free, driving the Hono router with fake stores.
 *
 * Covers the RBAC guard, own-vendor scoping (a vendor-kind actor reaching another's record → 403), the
 * resumable Draft lifecycle (me / create / one-per-owner / lenient update / Draft-only edit), and the
 * submit path: the M3.4 gate's not-ready 422, the tax-id duplicate 409 (pre-check + the index backstop),
 * and the happy Draft→Pending transition.
 */

import { describe, expect, test } from "bun:test";
import { type Actor, type RbacVerb, toPermissionSet } from "@vms/domain";
import { Hono } from "hono";
import { type AppEnv, requestContext } from "./context";
import type { VendorMembershipStore } from "./vendor-access";
import { type VendorDTO, type VendorStore, vendorRoutes } from "./vendor-route";

const VENDOR = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const CATEGORY = "33333333-3333-4333-8333-333333333333";
const COUNTRY = "44444444-4444-4444-8444-444444444444";
const ENTITY = "55555555-5555-4555-8555-555555555555";

/** An actor of the given kind holding the given verbs on the `vendors` module. */
const actor = (kind: "vendor" | "internal", verbs: readonly RbacVerb[]): Actor => ({
  userId: "user-1",
  kind,
  email: "u@soechi.id",
  name: "U",
  permissions: toPermissionSet(verbs.map((verb) => ({ module: "vendors" as const, verb }))),
});

const json = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

/** A complete local Draft that satisfies the profile half of the submit gate. */
const readyLocal: VendorDTO = {
  id: VENDOR,
  origin: "local",
  status: "draft",
  source: "self",
  name: "PT Contoh Jaya",
  businessEntityId: ENTITY,
  categoryId: CATEGORY,
  taxId: "01.234.567.8-901.000",
  taxStatus: "pkp_corporate",
  npwpType: "head_office",
  companyScale: "menengah",
  procurementNote: null,
  address: "Jl. Contoh No. 1",
  city: "Jakarta",
  postal: "12345",
  countryId: COUNTRY,
  phone: "+62211234567",
  fax: null,
  yearFounded: 2010,
  website: null,
  email: "contact@contoh.id",
  commissioner: null,
  director: "Budi",
  picName: "Sari",
  picRole: "Finance",
  picPhone: "+628123456789",
  picEmail: "sari@contoh.id",
  soechiReference: null,
  paymentTerm: "credit_30",
  signedTermsFileId: null,
  changePending: false,
};

/** A bank that passes the block invariants: one primary, holder = company, no out-of-country remark. */
const soundBank = {
  bankName: "Bank Mandiri",
  accountNo: "123",
  holderName: "PT Contoh Jaya",
  currencyIds: [COUNTRY],
  isPrimary: true,
  holderSameAsCompany: true,
} as const;

const fakeStore = (overrides: Partial<VendorStore> = {}): VendorStore & { calls: string[] } => {
  const calls: string[] = [];
  return {
    calls,
    create: async (_ctx, ownerUserId, input) => {
      calls.push(`create:${ownerUserId}`);
      return { ...readyLocal, id: VENDOR, origin: input.origin, name: input.name, status: "draft" };
    },
    getById: async (id) => (id === VENDOR ? readyLocal : null),
    update: async (_ctx, id, input) => {
      calls.push(`update:${id}`);
      return id === VENDOR ? { ...readyLocal, name: input.name } : null;
    },
    submissionParts: async () => ({
      banks: [soundBank],
      requiredDocMasterIds: [],
      capturedDocuments: [],
    }),
    requiredDocuments: async () => [],
    taxIdTaken: async () => false,
    submit: async (_ctx, id) => {
      calls.push(`submit:${id}`);
      return "submitted";
    },
    ...overrides,
  };
};

const fakeMembership = (overrides: Partial<VendorMembershipStore> = {}): VendorMembershipStore => ({
  isMember: async () => true,
  ownedVendorId: async () => VENDOR,
  ...overrides,
});

const mount = (a: () => Actor | null, store: VendorStore, membership?: VendorMembershipStore) => {
  const app = new Hono<AppEnv>();
  app.use("*", requestContext(a));
  app.route("/", vendorRoutes(store, membership ?? fakeMembership()));
  return app;
};

describe("guard + ownership", () => {
  test("anonymous → 401", async () => {
    const res = await mount(() => null, fakeStore()).request(`/vendors/${VENDOR}`);
    expect(res.status).toBe(401);
  });

  test("view without the verb → 403", async () => {
    const res = await mount(() => actor("vendor", ["add"]), fakeStore()).request(
      `/vendors/${VENDOR}`,
    );
    expect(res.status).toBe(403);
  });

  test("vendor-kind actor reaching a vendor they don't own → 403 notOwner", async () => {
    const membership = fakeMembership({ isMember: async () => false });
    const res = await mount(() => actor("vendor", ["view"]), fakeStore(), membership).request(
      `/vendors/${OTHER}`,
    );
    expect(res.status).toBe(403);
    expect((await res.json()).error.messageKey).toBe("error.vendor.notOwner");
  });

  test("internal actor bypasses ownership (cross-vendor, RBAC-bounded)", async () => {
    const membership = fakeMembership({ isMember: async () => false });
    const res = await mount(() => actor("internal", ["view"]), fakeStore(), membership).request(
      `/vendors/${VENDOR}`,
    );
    expect(res.status).toBe(200);
  });
});

describe("GET /vendors/:id/required-documents", () => {
  test("returns the required doc list for the owner", async () => {
    const store = fakeStore({
      requiredDocuments: async () => [
        { documentMasterId: "d1", no: "DOC-001", nameId: "NPWP", nameEn: "NPWP", captured: true },
      ],
    });
    const res = await mount(() => actor("vendor", ["view"]), store).request(
      `/vendors/${VENDOR}/required-documents`,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: { no: string }[] };
    expect(body.items[0]?.no).toBe("DOC-001");
  });
});

describe("GET /vendors/me — resume", () => {
  test("returns the owned Draft", async () => {
    const res = await mount(() => actor("vendor", ["view"]), fakeStore()).request("/vendors/me");
    expect(res.status).toBe(200);
    expect((await res.json()).item.id).toBe(VENDOR);
  });

  test("404 when the caller owns no vendor yet", async () => {
    const membership = fakeMembership({ ownedVendorId: async () => null });
    const res = await mount(() => actor("vendor", ["view"]), fakeStore(), membership).request(
      "/vendors/me",
    );
    expect(res.status).toBe(404);
  });
});

describe("POST /vendors — create Draft", () => {
  test("201 creates a Draft + owner link when the caller owns none", async () => {
    const membership = fakeMembership({ ownedVendorId: async () => null });
    const store = fakeStore();
    const res = await mount(() => actor("vendor", ["add"]), store, membership).request(
      "/vendors",
      json("POST", { origin: "local", source: "self", name: "PT Baru" }),
    );
    expect(res.status).toBe(201);
    expect(store.calls).toContain("create:user-1");
  });

  test("409 alreadyRegistered when the caller already owns one", async () => {
    const res = await mount(() => actor("vendor", ["add"]), fakeStore()).request(
      "/vendors",
      json("POST", { origin: "local", source: "self", name: "PT Baru" }),
    );
    expect(res.status).toBe(409);
    expect((await res.json()).error.messageKey).toBe("error.vendor.alreadyRegistered");
  });
});

describe("PUT /vendors/:id — lenient Draft save", () => {
  test("200 saves a partial update", async () => {
    const store = fakeStore();
    const res = await mount(() => actor("vendor", ["edit"]), store).request(
      `/vendors/${VENDOR}`,
      json("PUT", { origin: "local", source: "self", name: "PT Ubah" }),
    );
    expect(res.status).toBe(200);
    expect(store.calls).toContain(`update:${VENDOR}`);
  });

  test("409 notDraft on a non-Draft vendor", async () => {
    const store = fakeStore({ getById: async () => ({ ...readyLocal, status: "pending" }) });
    const res = await mount(() => actor("vendor", ["edit"]), store).request(
      `/vendors/${VENDOR}`,
      json("PUT", { origin: "local", source: "self", name: "PT Ubah" }),
    );
    expect(res.status).toBe(409);
    expect((await res.json()).error.messageKey).toBe("error.vendor.notDraft");
  });
});

describe("POST /vendors/:id/submit — the gate", () => {
  test("200 Draft→Pending when complete", async () => {
    const store = fakeStore();
    const res = await mount(() => actor("vendor", ["edit"]), store).request(
      `/vendors/${VENDOR}/submit`,
      json("POST", {}),
    );
    expect(res.status).toBe(200);
    expect(store.calls).toContain(`submit:${VENDOR}`);
  });

  test("422 with blockers when a required field is missing", async () => {
    const store = fakeStore({
      getById: async () => ({ ...readyLocal, taxId: null, taxStatus: null }),
    });
    const res = await mount(() => actor("vendor", ["edit"]), store).request(
      `/vendors/${VENDOR}/submit`,
      json("POST", {}),
    );
    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: { messageKey: string } };
    expect(body.error.messageKey).toBe("error.vendor.notSubmittable");
  });

  test("422 when no bank account exists", async () => {
    const store = fakeStore({
      submissionParts: async () => ({ banks: [], requiredDocMasterIds: [], capturedDocuments: [] }),
    });
    const res = await mount(() => actor("vendor", ["edit"]), store).request(
      `/vendors/${VENDOR}/submit`,
      json("POST", {}),
    );
    expect(res.status).toBe(422);
  });

  test("409 taxIdDuplicate when the Tax ID is already held by a non-Draft vendor", async () => {
    const store = fakeStore({ taxIdTaken: async () => true });
    const res = await mount(() => actor("vendor", ["edit"]), store).request(
      `/vendors/${VENDOR}/submit`,
      json("POST", {}),
    );
    expect(res.status).toBe(409);
    expect((await res.json()).error.messageKey).toBe("error.vendor.taxIdDuplicate");
    expect(store.calls).not.toContain(`submit:${VENDOR}`);
  });

  test("422 missing mandatory document", async () => {
    const store = fakeStore({
      submissionParts: async () => ({
        banks: [soundBank],
        requiredDocMasterIds: ["doc-1"],
        capturedDocuments: [{ documentMasterId: "doc-1", hasCurrentVersion: false }],
      }),
    });
    const res = await mount(() => actor("vendor", ["edit"]), store).request(
      `/vendors/${VENDOR}/submit`,
      json("POST", {}),
    );
    expect(res.status).toBe(422);
  });
});
