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
  type DecidedSubject,
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

/** The vendor + document a decision was about — what a rejection notice is built from (M6.2). */
const subject: DecidedSubject = {
  vendorId: VENDOR,
  vendorName: "PT Contoh Jaya",
  documentNameId: "Akta Pendirian",
  documentNameEn: "Deed of Establishment",
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
      return { ok: true, item: decided, subject };
    },
    reject: async (ctx, versionId, reason, verifier) => {
      spy.rejectCalls.push({ versionId, reason, verifier });
      return {
        ok: true,
        item: { ...decided, verifyStatus: "rejected", rejectReason: reason },
        subject,
      };
    },
    versionObjectKey: async () => "document-versions/abc",
    ...overrides,
  };
};

const mount = (
  a: () => Actor | null,
  store: DocumentVerificationStore,
  // Defaults to a no-op, like `store`/`storage` default to fakes here: the router's real default is
  // the live notifier, which would reach for Postgres to find the vendor's owner. These tests are
  // DB-free by construction, so a test that cares about dispatch injects a spy and says so.
  notify: VerificationNotifier = () => {},
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
// live vs Postgres); the route surfaces that on the response and fires the notify seam.
//
// M6.2 (#78) widened the seam: it now fires on **every** rejection, mandatory or not, with
// `returnedToDraft` telling the templates which copy to use rather than deciding whether the vendor
// hears anything at all. The optional case previously asserted silence — that was the M5.3 seam having
// nothing to say, not a decision that an optional rejection is unworthy of an email.
describe("POST reject — M5.3 return-to-draft + M6.2 notify seam", () => {
  type Fired = { versionId: string; reason: string; vendorId: string; returnedToDraft: boolean };
  const spyNotifier =
    (fired: Fired[]): VerificationNotifier =>
    (e) => {
      fired.push({
        versionId: e.versionId,
        reason: e.reason,
        vendorId: e.subject.vendorId,
        returnedToDraft: e.returnedToDraft,
      });
    };

  const bounced = (): Partial<DocumentVerificationStore> => ({
    reject: async (_ctx, versionId, reason) => ({
      ok: true,
      item: { ...decided, verifyStatus: "rejected", rejectReason: reason, id: versionId },
      subject,
      returnedToDraft: { vendorId: VENDOR },
    }),
  });

  test("mandatory-doc reject → response flags returnedToDraft + notifies with the bounce", async () => {
    const fired: Fired[] = [];
    const res = await mount(
      () => actor(["approve"]),
      fakeStore(bounced()),
      spyNotifier(fired),
    ).request(
      `/console/document-verification/versions/${VERSION}/reject`,
      json("POST", { reason: "expired certificate" }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { returnedToDraft: boolean };
    expect(body.returnedToDraft).toBe(true);
    expect(fired).toEqual([
      {
        versionId: VERSION,
        reason: "expired certificate",
        vendorId: VENDOR,
        returnedToDraft: true,
      },
    ]);
  });

  test("optional-doc reject → notifies too, but flagged as no bounce (M6.2)", async () => {
    const fired: Fired[] = [];
    const res = await mount(() => actor(["approve"]), fakeStore(), spyNotifier(fired)).request(
      `/console/document-verification/versions/${VERSION}/reject`,
      json("POST", { reason: "blurry scan" }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { returnedToDraft: boolean };
    expect(body.returnedToDraft).toBe(false);
    // Fired — the vendor is owed the reason — but flagged false, so the copy can't claim the
    // registration moved when it didn't.
    expect(fired).toEqual([
      { versionId: VERSION, reason: "blurry scan", vendorId: VENDOR, returnedToDraft: false },
    ]);
  });

  test("a verify never notifies — only a rejection is news the vendor must act on", async () => {
    const fired: Fired[] = [];
    const res = await mount(() => actor(["approve"]), fakeStore(), spyNotifier(fired)).request(
      `/console/document-verification/versions/${VERSION}/verify`,
      json("POST", {}),
    );
    expect(res.status).toBe(200);
    expect(fired).toEqual([]);
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
