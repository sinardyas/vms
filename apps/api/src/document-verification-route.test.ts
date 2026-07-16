/**
 * Document-verification route tests (M5.1, #68) — DB-free, driving the Hono router with a fake store.
 *
 * Covers the RBAC guard (view vs approve, the `documents` module), the queue read + `?vendorId` filter,
 * the presign, verify (dates recorded, actor stamped), reject (required reason → 400, otherwise applied),
 * and every decide guard mapped to its HTTP status (not_found 404, vendor_not_pending / not_current /
 * already_decided 409). The guard *logic* itself is unit-tested in `@vms/domain` (`isVersionDecidable`);
 * here we assert the router wires the store + failures correctly.
 */

import { describe, expect, test } from "bun:test";
import { type Actor, type RbacVerb, toPermissionSet } from "@vms/domain";
import { Hono } from "hono";
import { type AppEnv, requestContext } from "./context";
import {
  type DecideFailure,
  type DocumentVerificationStore,
  type VerificationNotifier,
  type VerifiedVersionDTO,
  documentVerificationRoutes,
} from "./document-verification-route";
import type { AttachmentStorage } from "./storage";

const VERSION = "11111111-1111-4111-8111-111111111111";
const VENDOR = "22222222-2222-4222-8222-222222222222";
const USER = "user-1";

/** An internal actor holding the given verbs on the `documents` module. */
const actor = (verbs: readonly RbacVerb[]): Actor => ({
  userId: USER,
  kind: "internal",
  email: "u@soechi.id",
  name: "U",
  permissions: toPermissionSet(verbs.map((verb) => ({ module: "documents" as const, verb }))),
});

const json = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

const decided: VerifiedVersionDTO = {
  id: VERSION,
  slotId: "slot-1",
  versionNo: 1,
  verifyStatus: "verified",
  issuedOn: "2026-01-01",
  expiresOn: "2027-01-01",
  verifiedBy: USER,
  verifiedAt: new Date("2026-07-16T00:00:00.000Z"),
  rejectReason: null,
};

type Spy = {
  queueFilters: { vendorId?: string }[];
  verifyCalls: { versionId: string; dates: unknown; verifier?: string }[];
  rejectCalls: { versionId: string; reason: string; verifier?: string }[];
};

const fakeStore = (
  overrides: Partial<DocumentVerificationStore> = {},
): DocumentVerificationStore & { spy: Spy } => {
  const spy: Spy = { queueFilters: [], verifyCalls: [], rejectCalls: [] };
  return {
    spy,
    queue: async (filter) => {
      spy.queueFilters.push(filter);
      return [
        {
          versionId: VERSION,
          slotId: "slot-1",
          vendorId: VENDOR,
          vendorName: "PT Contoh Jaya",
          documentMasterId: "dm-1",
          documentNo: "DOC-001",
          documentNameId: "NPWP",
          documentNameEn: "Tax ID",
          documentMandatory: true,
          versionNo: 1,
          refNo: "01.234.567.8-999.000",
          variant: null,
          uploadedAt: new Date("2026-07-16T00:00:00.000Z"),
        },
      ];
    },
    verify: async (ctx, versionId, dates, verifier) => {
      spy.verifyCalls.push({ versionId, dates, verifier });
      return { ok: true, item: decided };
    },
    reject: async (ctx, versionId, reason, verifier) => {
      spy.rejectCalls.push({ versionId, reason, verifier });
      return { ok: true, item: { ...decided, verifyStatus: "rejected", rejectReason: reason } };
    },
    versionObjectKey: async () => "document-versions/abc",
    ...overrides,
  };
};

const mount = (
  a: () => Actor | null,
  store: DocumentVerificationStore,
  notify?: VerificationNotifier,
) => {
  const storage = { presignGet: async (k: string) => `https://minio.local/${k}?sig=x` };
  const app = new Hono<AppEnv>();
  app.use("*", requestContext(a));
  app.route(
    "/console/document-verification",
    documentVerificationRoutes(store, storage as unknown as AttachmentStorage, notify),
  );
  return app;
};

const failing = (reason: DecideFailure): Partial<DocumentVerificationStore> => ({
  verify: async () => ({ ok: false, reason }),
  reject: async () => ({ ok: false, reason }),
});

describe("guard", () => {
  test("anonymous → 401", async () => {
    const res = await mount(() => null, fakeStore()).request("/console/document-verification");
    expect(res.status).toBe(401);
  });

  test("without documents:view → 403", async () => {
    const res = await mount(() => actor([]), fakeStore()).request("/console/document-verification");
    expect(res.status).toBe(403);
  });

  test("verify without documents:approve → 403", async () => {
    const res = await mount(() => actor(["view"]), fakeStore()).request(
      `/console/document-verification/versions/${VERSION}/verify`,
      json("POST", {}),
    );
    expect(res.status).toBe(403);
  });
});

describe("GET / — queue", () => {
  test("lists pending documents; unscoped by default", async () => {
    const store = fakeStore();
    const res = await mount(() => actor(["view"]), store).request("/console/document-verification");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: { versionId: string }[] };
    expect(body.items.map((i) => i.versionId)).toEqual([VERSION]);
    expect(store.spy.queueFilters).toEqual([{}]);
  });

  test("?vendorId scopes the filter", async () => {
    const store = fakeStore();
    await mount(() => actor(["view"]), store).request(
      `/console/document-verification?vendorId=${VENDOR}`,
    );
    expect(store.spy.queueFilters).toEqual([{ vendorId: VENDOR }]);
  });
});

describe("GET /versions/:id/url — presign", () => {
  test("returns a signed url", async () => {
    const res = await mount(() => actor(["view"]), fakeStore()).request(
      `/console/document-verification/versions/${VERSION}/url`,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { url: string };
    expect(body.url).toContain("document-versions/abc");
  });

  test("unknown version → 404", async () => {
    const res = await mount(
      () => actor(["view"]),
      fakeStore({ versionObjectKey: async () => null }),
    ).request(`/console/document-verification/versions/${VERSION}/url`);
    expect(res.status).toBe(404);
  });
});

describe("POST verify", () => {
  test("records dates + stamps the actor", async () => {
    const store = fakeStore();
    const res = await mount(() => actor(["view", "approve"]), store).request(
      `/console/document-verification/versions/${VERSION}/verify`,
      json("POST", { issuedOn: "2026-01-01", expiresOn: "2027-01-01" }),
    );
    expect(res.status).toBe(200);
    expect(store.spy.verifyCalls).toEqual([
      {
        versionId: VERSION,
        dates: { issuedOn: "2026-01-01", expiresOn: "2027-01-01" },
        verifier: USER,
      },
    ]);
  });

  test("accepts an empty body (perpetual doc, no dates)", async () => {
    const store = fakeStore();
    const res = await mount(() => actor(["approve"]), store).request(
      `/console/document-verification/versions/${VERSION}/verify`,
      json("POST", {}),
    );
    expect(res.status).toBe(200);
    expect(store.spy.verifyCalls[0]?.dates).toEqual({});
  });

  test("expiry before issue → 400 (validation)", async () => {
    const res = await mount(() => actor(["approve"]), fakeStore()).request(
      `/console/document-verification/versions/${VERSION}/verify`,
      json("POST", { issuedOn: "2027-01-01", expiresOn: "2026-01-01" }),
    );
    expect(res.status).toBe(400);
  });
});

describe("POST reject", () => {
  test("applies with a reason", async () => {
    const store = fakeStore();
    const res = await mount(() => actor(["approve"]), store).request(
      `/console/document-verification/versions/${VERSION}/reject`,
      json("POST", { reason: "blurry scan" }),
    );
    expect(res.status).toBe(200);
    expect(store.spy.rejectCalls).toEqual([
      { versionId: VERSION, reason: "blurry scan", verifier: USER },
    ]);
  });

  test("missing reason → 400 (validation)", async () => {
    const store = fakeStore();
    const res = await mount(() => actor(["approve"]), store).request(
      `/console/document-verification/versions/${VERSION}/reject`,
      json("POST", {}),
    );
    expect(res.status).toBe(400);
    expect(store.spy.rejectCalls).toEqual([]);
  });
});

// M5.3 (#70): rejecting a **mandatory** doc returns the registration to Draft (the store's bounce, tested
// live vs Postgres); the route's job is to surface that on the response and fire the notify seam. An
// optional-doc reject does neither. (The DB bounce itself is store-level — exercised end-to-end live.)
describe("POST reject — M5.3 return-to-draft + notify seam", () => {
  const bounced = (): Partial<DocumentVerificationStore> => ({
    reject: async (_ctx, versionId, reason) => ({
      ok: true,
      item: { ...decided, verifyStatus: "rejected", rejectReason: reason, id: versionId },
      returnedToDraft: { vendorId: VENDOR },
    }),
  });

  test("mandatory-doc reject → response flags returnedToDraft + fires notify", async () => {
    const notified: { vendorId: string; versionId: string; reason: string }[] = [];
    const res = await mount(
      () => actor(["approve"]),
      fakeStore(bounced()),
      (e) => {
        notified.push({ vendorId: e.vendorId, versionId: e.versionId, reason: e.reason });
      },
    ).request(
      `/console/document-verification/versions/${VERSION}/reject`,
      json("POST", { reason: "expired certificate" }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { returnedToDraft: boolean };
    expect(body.returnedToDraft).toBe(true);
    expect(notified).toEqual([
      { vendorId: VENDOR, versionId: VERSION, reason: "expired certificate" },
    ]);
  });

  test("optional-doc reject → returnedToDraft false + notify NOT fired", async () => {
    let notifyCount = 0;
    const res = await mount(
      () => actor(["approve"]),
      fakeStore(),
      () => {
        notifyCount += 1;
      },
    ).request(
      `/console/document-verification/versions/${VERSION}/reject`,
      json("POST", { reason: "blurry scan" }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { returnedToDraft: boolean };
    expect(body.returnedToDraft).toBe(false);
    expect(notifyCount).toBe(0);
  });
});

describe("decide failures → HTTP status", () => {
  const cases: [DecideFailure, number][] = [
    ["not_found", 404],
    ["vendor_not_pending", 409],
    ["not_current", 409],
    ["already_decided", 409],
  ];
  for (const [reason, status] of cases) {
    test(`verify ${reason} → ${status}`, async () => {
      const res = await mount(() => actor(["approve"]), fakeStore(failing(reason))).request(
        `/console/document-verification/versions/${VERSION}/verify`,
        json("POST", {}),
      );
      expect(res.status).toBe(status);
    });
  }
});
