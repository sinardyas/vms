/**
 * Vendor compliance-document capture (M3.3, #44). Run with `bun test`.
 *
 * Database-free: fakes stand in for the {@link VendorDocumentStore} and {@link AttachmentStorage}, so
 * this pins the route's contract — the guard on every path (anonymous → 401, wrong verb → 403), the
 * multipart field validation, the unknown-vendor 404, the unknown-document-type 422, the upload → version
 * wiring (type/size validation runs, file id flows into `addVersion`), the presign, and slot delete. The
 * slot upsert + version bump live in the store's transaction and are exercised live under Docker.
 */

import { describe, expect, test } from "bun:test";
import { type Actor, type RbacVerb, toPermissionSet } from "@vms/domain";
import { Hono } from "hono";
import { type AppEnv, requestContext } from "./context";
import { type AttachmentStorage, type StoredFile, validateAttachment } from "./storage";
import {
  type DocumentSlotDTO,
  type VendorDocumentStore,
  vendorDocumentsRoutes,
} from "./vendor-documents-route";

const VENDOR = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const DOC = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const SLOT = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const VERSION = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const FILE = "ffffffff-ffff-4fff-8fff-ffffffffffff";

/** A staff/vendor actor holding the given verbs on the `vendors` module. */
const actorWith = (verbs: readonly RbacVerb[]): Actor => ({
  userId: "user-1",
  kind: "internal",
  email: "u@soechi.id",
  name: "U",
  permissions: toPermissionSet(verbs.map((verb) => ({ module: "vendors" as const, verb }))),
});

const aSlot: DocumentSlotDTO = {
  id: SLOT,
  vendorId: VENDOR,
  documentMasterId: DOC,
  currentVersionId: VERSION,
  currentVersion: {
    id: VERSION,
    slotId: SLOT,
    versionNo: 1,
    fileId: FILE,
    refNo: "NPWP-01",
    variant: null,
    issuedOn: null,
    expiresOn: null,
    verifyStatus: "pending",
    verifiedBy: null,
    verifiedAt: null,
    rejectReason: null,
    uploadedBy: "user-1",
    createdAt: new Date("2026-07-16T00:00:00Z"),
  },
  versions: [],
};

const fakeStore = (
  overrides: Partial<VendorDocumentStore> = {},
): VendorDocumentStore & { calls: string[] } => {
  const calls: string[] = [];
  return {
    calls,
    vendorExists: overrides.vendorExists ?? (async () => true),
    documentMasterExists: overrides.documentMasterExists ?? (async () => true),
    list: overrides.list ?? (async () => [aSlot]),
    addVersion:
      overrides.addVersion ??
      (async (_ctx, _v, input, fileId) => {
        calls.push(`addVersion:${input.documentMasterId}:${fileId}`);
        return aSlot;
      }),
    versionObjectKey: overrides.versionObjectKey ?? (async () => "document-versions/key.pdf"),
    removeSlot:
      overrides.removeSlot ??
      (async (_ctx, _v, slotId) => {
        calls.push(`removeSlot:${slotId}`);
        return aSlot;
      }),
  };
};

/** In-memory storage that runs the real content-type/size validation but touches no MinIO/Postgres. */
const fakeStorage = (): AttachmentStorage & { stored: StoredFile[] } => {
  const stored: StoredFile[] = [];
  return {
    stored,
    upload: async (input) => {
      const invalid = validateAttachment(input.mime, input.sizeBytes);
      if (invalid) return { ok: false, error: invalid };
      const file: StoredFile = {
        id: FILE,
        bucket: "vms-documents",
        objectKey: `${input.keyPrefix ?? "vendor-banks"}/${input.originalName ?? "file"}`,
        mime: input.mime,
        sizeBytes: input.sizeBytes,
        originalName: input.originalName ?? null,
      };
      stored.push(file);
      return { ok: true, value: file };
    },
    presignGet: async (key) => `https://minio.local/${key}?sig=abc`,
  };
};

const mount = (
  actor: () => Actor | null,
  store: VendorDocumentStore,
  storage?: AttachmentStorage,
) => {
  const app = new Hono<AppEnv>();
  app.use("*", requestContext(actor));
  app.route("/vendors", vendorDocumentsRoutes(store, storage ?? fakeStorage()));
  return app;
};

/** A multipart version upload: a file plus the metadata fields. */
const upload = (file: File, fields: Record<string, string> = {}): RequestInit => {
  const form = new FormData();
  form.set("file", file);
  for (const [k, v] of Object.entries(fields)) form.set(k, v);
  return { method: "POST", body: form };
};

const pdf = () => new File([new Uint8Array([1, 2, 3])], "npwp.pdf", { type: "application/pdf" });

describe("guard — every path gates on the vendors module", () => {
  test("anonymous list → 401", async () => {
    const res = await mount(() => null, fakeStore()).request(`/vendors/${VENDOR}/documents`);
    expect(res.status).toBe(401);
    expect((await res.json()).error.messageKey).toBe("error.unauthorized");
  });
  test("upload a version without `add` → 403", async () => {
    const res = await mount(() => actorWith(["view"]), fakeStore()).request(
      `/vendors/${VENDOR}/documents/versions`,
      upload(pdf(), { documentMasterId: DOC }),
    );
    expect(res.status).toBe(403);
  });
});

describe("upload a version — validation + wiring", () => {
  test("201 on a valid PDF; file id flows into addVersion; doc-versions namespace", async () => {
    const store = fakeStore();
    const storage = fakeStorage();
    const res = await mount(() => actorWith(["add"]), store, storage).request(
      `/vendors/${VENDOR}/documents/versions`,
      upload(pdf(), { documentMasterId: DOC, refNo: "NPWP-01" }),
    );
    expect(res.status).toBe(201);
    expect(store.calls).toContain(`addVersion:${DOC}:${FILE}`);
    expect(storage.stored[0]?.objectKey).toStartWith("document-versions/");
  });
  test("upload on an unknown vendor → 404", async () => {
    const store = fakeStore({ vendorExists: async () => false });
    const res = await mount(() => actorWith(["add"]), store).request(
      `/vendors/${VENDOR}/documents/versions`,
      upload(pdf(), { documentMasterId: DOC }),
    );
    expect(res.status).toBe(404);
  });
  test("400 when documentMasterId is missing", async () => {
    const res = await mount(() => actorWith(["add"]), fakeStore()).request(
      `/vendors/${VENDOR}/documents/versions`,
      upload(pdf()),
    );
    expect(res.status).toBe(400);
  });
  test("422 on an unknown document type — nothing uploaded", async () => {
    const store = fakeStore({ documentMasterExists: async () => false });
    const storage = fakeStorage();
    const res = await mount(() => actorWith(["add"]), store, storage).request(
      `/vendors/${VENDOR}/documents/versions`,
      upload(pdf(), { documentMasterId: DOC }),
    );
    expect(res.status).toBe(422);
    expect((await res.json()).error.messageKey).toBe("error.document.masterUnknown");
    expect(storage.stored).toHaveLength(0);
  });
  test("400 on a disallowed content type, nothing stored", async () => {
    const storage = fakeStorage();
    const res = await mount(() => actorWith(["add"]), fakeStore(), storage).request(
      `/vendors/${VENDOR}/documents/versions`,
      upload(new File([new Uint8Array([1])], "x.exe", { type: "application/x-msdownload" }), {
        documentMasterId: DOC,
      }),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error.messageKey).toBe("error.file.badType");
    expect(storage.stored).toHaveLength(0);
  });
  test("upload without a file field → 400", async () => {
    const form = new FormData();
    form.set("documentMasterId", DOC);
    const res = await mount(() => actorWith(["add"]), fakeStore()).request(
      `/vendors/${VENDOR}/documents/versions`,
      { method: "POST", body: form },
    );
    expect(res.status).toBe(400);
  });
});

describe("list + presign + delete", () => {
  test("list → 200 with slots", async () => {
    const res = await mount(() => actorWith(["view"]), fakeStore()).request(
      `/vendors/${VENDOR}/documents`,
    );
    expect(res.status).toBe(200);
    expect((await res.json()).items).toHaveLength(1);
  });
  test("list on an unknown vendor → 404", async () => {
    const store = fakeStore({ vendorExists: async () => false });
    const res = await mount(() => actorWith(["view"]), store).request(
      `/vendors/${VENDOR}/documents`,
    );
    expect(res.status).toBe(404);
  });
  test("presign a version → 200 url", async () => {
    const res = await mount(() => actorWith(["view"]), fakeStore()).request(
      `/vendors/${VENDOR}/documents/versions/${VERSION}/url`,
    );
    expect(res.status).toBe(200);
    expect((await res.json()).url).toContain("document-versions/key.pdf");
  });
  test("presign an unknown version → 404", async () => {
    const store = fakeStore({ versionObjectKey: async () => null });
    const res = await mount(() => actorWith(["view"]), store).request(
      `/vendors/${VENDOR}/documents/versions/${VERSION}/url`,
    );
    expect(res.status).toBe(404);
  });
  test("DELETE a slot → 200 + store.removeSlot", async () => {
    const store = fakeStore();
    const res = await mount(() => actorWith(["delete"]), store).request(
      `/vendors/${VENDOR}/documents/slots/${SLOT}`,
      { method: "DELETE" },
    );
    expect(res.status).toBe(200);
    expect(store.calls).toContain(`removeSlot:${SLOT}`);
  });
  test("DELETE an unknown slot → 404", async () => {
    const store = fakeStore({ removeSlot: async () => null });
    const res = await mount(() => actorWith(["delete"]), store).request(
      `/vendors/${VENDOR}/documents/slots/${SLOT}`,
      { method: "DELETE" },
    );
    expect(res.status).toBe(404);
  });
});
