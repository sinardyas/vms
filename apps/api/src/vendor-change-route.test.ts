/**
 * Post-activation change requests (M4.5, #60). Run with `bun test`.
 *
 * Database-free: a fake stands in for the {@link VendorChangeStore}, so this pins the route's contract —
 * the RBAC guard on every path (anonymous → 401, wrong verb → 403), the Active-only gate (409), the two
 * business invariants the shared Zod can't express (a non-bank diff that drops a required profile field →
 * 422; a bank diff with an out-of-country account and no remark → 422), the one-pending-change lock (409),
 * and the read/cancel wiring. Applying the diff itself lives in `vendor-change.ts` and runs live.
 */

import { describe, expect, test } from "bun:test";
import { type Actor, type RbacVerb, toPermissionSet } from "@vms/domain";
import { Hono } from "hono";
import { type AppEnv, requestContext } from "./context";
import {
  type ChangeRequestDTO,
  type CreateChangeOutcome,
  type VendorChangeRef,
  type VendorChangeStore,
  vendorChangeRoutes,
} from "./vendor-change-route";

const VENDOR = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const REQUEST = "11111111-1111-4111-8111-111111111111";
const ID_COUNTRY = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const SG_COUNTRY = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const UUID = "22222222-2222-4222-8222-222222222222";
const CUR = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

const actorWith = (verbs: readonly RbacVerb[]): Actor => ({
  userId: "user-1",
  kind: "internal",
  email: "u@soechi.id",
  name: "U",
  permissions: toPermissionSet(verbs.map((verb) => ({ module: "vendors" as const, verb }))),
});

const json = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

/** A foreign, Active vendor whose country is Indonesia — the subject of an edit. */
const activeVendor: VendorChangeRef = {
  id: VENDOR,
  status: "active",
  origin: "foreign",
  countryId: ID_COUNTRY,
};

/** A complete foreign-origin profile (its required set = the common fields only). */
const completeProfile = {
  name: "PT Contoh Jaya",
  businessEntityId: UUID,
  categoryId: UUID,
  address: "Jl. Contoh 1",
  city: "Jakarta",
  countryId: ID_COUNTRY,
  phone: "021555000",
  picName: "Budi",
  picPhone: "0811222333",
  picEmail: "budi@contoh.id",
  paymentTerm: "credit_30",
} as const;

const goodBank = {
  bankName: "Bank Mandiri",
  accountNo: "1234567890",
  holderName: "PT Contoh Jaya",
  currencyIds: [CUR],
  holderSameAsCompany: true,
  isPrimary: true,
} as const;

const changeDTO: ChangeRequestDTO = {
  requestId: REQUEST,
  kind: "non_bank",
  trigger: "non_bank_change",
  status: "pending",
  currentStepNo: 1,
  payload: { kind: "non_bank", profile: completeProfile },
  createdAt: "2026-07-16T00:00:00.000Z",
};

const fakeStore = (
  overrides: Partial<VendorChangeStore> = {},
  vendor: VendorChangeRef | null = activeVendor,
): VendorChangeStore & { calls: string[] } => {
  const calls: string[] = [];
  return {
    calls,
    getVendor: overrides.getVendor ?? (async () => vendor),
    create:
      overrides.create ??
      (async (_ctx, _v, change): Promise<CreateChangeOutcome> => {
        calls.push(`create:${change.kind}`);
        return { ok: true, requestId: REQUEST };
      }),
    current: overrides.current ?? (async () => changeDTO),
    cancel:
      overrides.cancel ??
      (async () => {
        calls.push("cancel");
        return "cancelled";
      }),
  };
};

const mount = (actor: () => Actor | null, store: VendorChangeStore) => {
  const app = new Hono<AppEnv>();
  app.use("*", requestContext(actor));
  app.route("/vendors", vendorChangeRoutes(store));
  return app;
};

const post = (app: Hono<AppEnv>, path: string, body: unknown) =>
  app.request(`/vendors/${VENDOR}/change-requests${path}`, json("POST", body));

describe("guard — every path gates on the vendors module", () => {
  test("anonymous create → 401", async () => {
    const res = await post(
      mount(() => null, fakeStore()),
      "",
      { kind: "non_bank", profile: completeProfile },
    );
    expect(res.status).toBe(401);
  });
  test("create without `edit` → 403", async () => {
    const res = await post(
      mount(() => actorWith(["view"]), fakeStore()),
      "",
      {
        kind: "non_bank",
        profile: completeProfile,
      },
    );
    expect(res.status).toBe(403);
  });
  test("read current without `view` → 403", async () => {
    const res = await mount(() => actorWith(["edit"]), fakeStore()).request(
      `/vendors/${VENDOR}/change-requests/current`,
    );
    expect(res.status).toBe(403);
  });
  test("cancel without `edit` → 403", async () => {
    const res = await post(
      mount(() => actorWith(["view"]), fakeStore()),
      "/cancel",
      {},
    );
    expect(res.status).toBe(403);
  });
});

describe("POST create — raise a change", () => {
  const app = () => mount(() => actorWith(["edit", "view"]), fakeStore());

  test("unknown vendor → 404", async () => {
    const res = await post(
      mount(() => actorWith(["edit"]), fakeStore({}, null)),
      "",
      {
        kind: "non_bank",
        profile: completeProfile,
      },
    );
    expect(res.status).toBe(404);
  });

  test("non-Active vendor → 409 notActive", async () => {
    const draft = { ...activeVendor, status: "draft" as const };
    const res = await post(
      mount(() => actorWith(["edit"]), fakeStore({}, draft)),
      "",
      {
        kind: "non_bank",
        profile: completeProfile,
      },
    );
    expect(res.status).toBe(409);
    expect((await res.json()).error.messageKey).toBe("error.vendor.notActive");
  });

  test("malformed diff (bad kind) → 400 validation", async () => {
    const res = await post(app(), "", { kind: "nope" });
    expect(res.status).toBe(400);
  });

  test("non-bank diff missing a required field → 422 changeIncomplete", async () => {
    const { paymentTerm, ...withoutPaymentTerm } = completeProfile;
    const res = await post(app(), "", { kind: "non_bank", profile: withoutPaymentTerm });
    expect(res.status).toBe(422);
    expect((await res.json()).error.messageKey).toBe("error.vendor.changeIncomplete");
  });

  test("bank diff that strips every account → 422 bankRequired", async () => {
    const res = await post(app(), "", { kind: "bank", banks: [] });
    expect(res.status).toBe(422);
    expect((await res.json()).error.messageKey).toBe("error.vendor.bankRequired");
  });

  test("bank diff with out-of-country account and no remark → 422", async () => {
    const res = await post(app(), "", {
      kind: "bank",
      banks: [{ ...goodBank, bankCountryId: SG_COUNTRY }],
    });
    expect(res.status).toBe(422);
    expect((await res.json()).error.messageKey).toBe("error.bank.countryRemarkRequired");
  });

  test("valid non-bank change → 201 + store.create('non_bank')", async () => {
    const store = fakeStore();
    const res = await post(
      mount(() => actorWith(["edit", "view"]), store),
      "",
      {
        kind: "non_bank",
        profile: completeProfile,
      },
    );
    expect(res.status).toBe(201);
    expect(store.calls).toContain("create:non_bank");
    expect((await res.json()).item.requestId).toBe(REQUEST);
  });

  test("valid bank change (out-of-country w/ remark) → 201 + store.create('bank')", async () => {
    const store = fakeStore();
    const res = await post(
      mount(() => actorWith(["edit", "view"]), store),
      "",
      {
        kind: "bank",
        banks: [{ ...goodBank, bankCountryId: SG_COUNTRY, differsFromCompanyRemark: "HQ account" }],
      },
    );
    expect(res.status).toBe(201);
    expect(store.calls).toContain("create:bank");
  });

  test("one-pending-change lock → 409 changePending", async () => {
    const store = fakeStore({ create: async () => ({ ok: false, reason: "change_pending" }) });
    const res = await post(
      mount(() => actorWith(["edit", "view"]), store),
      "",
      {
        kind: "non_bank",
        profile: completeProfile,
      },
    );
    expect(res.status).toBe(409);
    expect((await res.json()).error.messageKey).toBe("error.approval.changePending");
  });
});

describe("GET current + POST cancel", () => {
  test("current when none open → 404", async () => {
    const store = fakeStore({ current: async () => null });
    const res = await mount(() => actorWith(["view"]), store).request(
      `/vendors/${VENDOR}/change-requests/current`,
    );
    expect(res.status).toBe(404);
  });

  test("current returns the kind + proposed diff", async () => {
    const res = await mount(() => actorWith(["view"]), fakeStore()).request(
      `/vendors/${VENDOR}/change-requests/current`,
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.item.kind).toBe("non_bank");
    expect(body.item.payload.profile.name).toBe("PT Contoh Jaya");
  });

  test("cancel pre-decision → 200 ok + store.cancel", async () => {
    const store = fakeStore();
    const res = await post(
      mount(() => actorWith(["edit"]), store),
      "/cancel",
      {},
    );
    expect(res.status).toBe(200);
    expect(store.calls).toContain("cancel");
  });

  test("cancel with nothing to withdraw → 409 notRecallable", async () => {
    const store = fakeStore({ cancel: async () => "none" });
    const res = await post(
      mount(() => actorWith(["edit"]), store),
      "/cancel",
      {},
    );
    expect(res.status).toBe(409);
    expect((await res.json()).error.messageKey).toBe("error.approval.notRecallable");
  });

  test("cancel after a decision → 409 recallAfterDecision", async () => {
    const store = fakeStore({ cancel: async () => "already_decided" });
    const res = await post(
      mount(() => actorWith(["edit"]), store),
      "/cancel",
      {},
    );
    expect(res.status).toBe(409);
    expect((await res.json()).error.messageKey).toBe("error.approval.recallAfterDecision");
  });
});
