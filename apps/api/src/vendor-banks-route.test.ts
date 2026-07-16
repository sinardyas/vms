/**
 * Vendor bank accounts + attachments (M3.2, #43). Run with `bun test`.
 *
 * Database-free: fakes stand in for the {@link VendorBankStore} and {@link FileStore}, so this pins the
 * route's contract — the guard on every path (anonymous → 401, wrong verb → 403), body validation, the
 * two per-account invariants (holder ≠ company ⇒ KTP+surat 422; bank country ≠ vendor country ⇒ remark
 * 422), and the attachment upload/presign wiring (type/size validation, 404 for an unset slot). The
 * one-primary *reconciliation* lives in the store's transaction and is exercised live under Docker.
 */

import { describe, expect, test } from "bun:test";
import { type Actor, type RbacVerb, toPermissionSet } from "@vms/domain";
import { Hono } from "hono";
import { type AppEnv, requestContext } from "./context";
import { type AttachmentStorage, type StoredFile, validateAttachment } from "./storage";
import {
  type VendorBankDTO,
  type VendorBankStore,
  type VendorRef,
  vendorBanksRoutes,
} from "./vendor-banks-route";

const VENDOR = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const BANK = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const CUR = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const ID_COUNTRY = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const SG_COUNTRY = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const FILE = "ffffffff-ffff-4fff-8fff-ffffffffffff";

/** A staff/vendor actor holding the given verbs on the `vendors` module. */
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

const aDTO: VendorBankDTO = {
  id: BANK,
  vendorId: VENDOR,
  bankId: null,
  bankName: "Bank Mandiri",
  accountNo: "123",
  holderName: "PT Contoh",
  branch: null,
  description: null,
  swift: null,
  iban: null,
  bankCountryId: null,
  isPrimary: true,
  holderSameAsCompany: true,
  differsFromCompanyRemark: null,
  proofFileId: null,
  ktpFileId: null,
  suratPernyataanFileId: null,
  currencyIds: [CUR],
};

const fakeStore = (
  overrides: Partial<VendorBankStore> = {},
  vendor: VendorRef | null = { id: VENDOR, countryId: ID_COUNTRY, status: "draft" },
): VendorBankStore & { calls: string[] } => {
  const calls: string[] = [];
  return {
    calls,
    getVendor: overrides.getVendor ?? (async () => vendor),
    list: overrides.list ?? (async () => [aDTO]),
    create:
      overrides.create ??
      (async (_ctx, _v, input) => {
        calls.push(`create:${input.accountNo}`);
        return aDTO;
      }),
    update:
      overrides.update ??
      (async (_ctx, _v, bankId) => {
        calls.push(`update:${bankId}`);
        return aDTO;
      }),
    remove:
      overrides.remove ??
      (async (_ctx, _v, bankId) => {
        calls.push(`remove:${bankId}`);
        return aDTO;
      }),
    attachmentKey: overrides.attachmentKey ?? (async () => "vendor-banks/key.pdf"),
  };
};

/**
 * An in-memory {@link AttachmentStorage} that runs the *real* content-type/size validation (so the
 * upload-rejection paths are exercised) but touches neither MinIO nor Postgres. Records stored uploads.
 */
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
        objectKey: `vendor-banks/${input.originalName ?? "file"}`,
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

const mount = (actor: () => Actor | null, store: VendorBankStore, storage?: AttachmentStorage) => {
  const app = new Hono<AppEnv>();
  app.use("*", requestContext(actor));
  app.route("/vendors", vendorBanksRoutes(store, storage ?? fakeStorage()));
  return app;
};

const goodBank = {
  bankName: "Bank Mandiri",
  accountNo: "1234567890",
  holderName: "PT Contoh Jaya",
  currencyIds: [CUR],
  holderSameAsCompany: true,
} as const;

describe("guard — every path gates on the vendors module", () => {
  test("anonymous list → 401", async () => {
    const res = await mount(() => null, fakeStore()).request(`/vendors/${VENDOR}/banks`);
    expect(res.status).toBe(401);
    expect((await res.json()).error.messageKey).toBe("error.unauthorized");
  });
  test("create without `add` → 403", async () => {
    const res = await mount(() => actorWith(["view"]), fakeStore()).request(
      `/vendors/${VENDOR}/banks`,
      json("POST", goodBank),
    );
    expect(res.status).toBe(403);
  });
});

describe("vendor existence", () => {
  test("list on an unknown vendor → 404", async () => {
    const store = fakeStore({}, null);
    const res = await mount(() => actorWith(["view"]), store).request(`/vendors/${VENDOR}/banks`);
    expect(res.status).toBe(404);
  });
});

describe("freeze — bank capture is Draft-only (M4.4, ADR-0014)", () => {
  const pending = { id: VENDOR, countryId: ID_COUNTRY, status: "pending" } as const;
  test("create on a Pending vendor → 409 notDraft, store.create untouched", async () => {
    const store = fakeStore({}, pending);
    const res = await mount(() => actorWith(["add"]), store).request(
      `/vendors/${VENDOR}/banks`,
      json("POST", goodBank),
    );
    expect(res.status).toBe(409);
    expect((await res.json()).error.messageKey).toBe("error.vendor.notDraft");
    expect(store.calls).toHaveLength(0);
  });
  test("update on a Pending vendor → 409 notDraft", async () => {
    const store = fakeStore({}, pending);
    const res = await mount(() => actorWith(["edit"]), store).request(
      `/vendors/${VENDOR}/banks/${BANK}`,
      json("PUT", goodBank),
    );
    expect(res.status).toBe(409);
    expect(store.calls).toHaveLength(0);
  });
  test("delete on a Pending vendor → 409 notDraft", async () => {
    const store = fakeStore({}, pending);
    const res = await mount(() => actorWith(["delete"]), store).request(
      `/vendors/${VENDOR}/banks/${BANK}`,
      { method: "DELETE" },
    );
    expect(res.status).toBe(409);
    expect(store.calls).toHaveLength(0);
  });
  test("attachment upload on a Pending vendor → 409 notDraft", async () => {
    const form = new FormData();
    form.set(
      "file",
      new File([new Uint8Array([1, 2, 3])], "proof.pdf", { type: "application/pdf" }),
    );
    const res = await mount(() => actorWith(["edit"]), fakeStore({}, pending)).request(
      `/vendors/${VENDOR}/banks/attachments`,
      { method: "POST", body: form },
    );
    expect(res.status).toBe(409);
  });
});

describe("create — body validation + invariants", () => {
  test("201 on a well-formed account, store.create called", async () => {
    const store = fakeStore();
    const res = await mount(() => actorWith(["add"]), store).request(
      `/vendors/${VENDOR}/banks`,
      json("POST", goodBank),
    );
    expect(res.status).toBe(201);
    expect(store.calls).toContain("create:1234567890");
  });
  test("400 when currencyIds is empty", async () => {
    const res = await mount(() => actorWith(["add"]), fakeStore()).request(
      `/vendors/${VENDOR}/banks`,
      json("POST", { ...goodBank, currencyIds: [] }),
    );
    expect(res.status).toBe(400);
  });
  test("422 when holder ≠ company but KTP/surat missing", async () => {
    const res = await mount(() => actorWith(["add"]), fakeStore()).request(
      `/vendors/${VENDOR}/banks`,
      json("POST", { ...goodBank, holderSameAsCompany: false }),
    );
    expect(res.status).toBe(422);
    expect((await res.json()).error.messageKey).toBe("error.bank.holderProofRequired");
  });
  test("201 when holder ≠ company and both files supplied", async () => {
    const res = await mount(() => actorWith(["add"]), fakeStore()).request(
      `/vendors/${VENDOR}/banks`,
      json("POST", {
        ...goodBank,
        holderSameAsCompany: false,
        ktpFileId: FILE,
        suratPernyataanFileId: FILE,
      }),
    );
    expect(res.status).toBe(201);
  });
  test("422 when bank country ≠ vendor country and no remark", async () => {
    const res = await mount(() => actorWith(["add"]), fakeStore()).request(
      `/vendors/${VENDOR}/banks`,
      json("POST", { ...goodBank, bankCountryId: SG_COUNTRY }),
    );
    expect(res.status).toBe(422);
    expect((await res.json()).error.messageKey).toBe("error.bank.countryRemarkRequired");
  });
  test("201 when the out-of-country account carries a remark", async () => {
    const res = await mount(() => actorWith(["add"]), fakeStore()).request(
      `/vendors/${VENDOR}/banks`,
      json("POST", {
        ...goodBank,
        bankCountryId: SG_COUNTRY,
        differsFromCompanyRemark: "USD operating account in Singapore",
      }),
    );
    expect(res.status).toBe(201);
  });
});

describe("update + delete", () => {
  test("PUT → 200 + store.update", async () => {
    const store = fakeStore();
    const res = await mount(() => actorWith(["edit"]), store).request(
      `/vendors/${VENDOR}/banks/${BANK}`,
      json("PUT", goodBank),
    );
    expect(res.status).toBe(200);
    expect(store.calls).toContain(`update:${BANK}`);
  });
  test("PUT on an unknown bank → 404", async () => {
    const store = fakeStore({ update: async () => null });
    const res = await mount(() => actorWith(["edit"]), store).request(
      `/vendors/${VENDOR}/banks/${BANK}`,
      json("PUT", goodBank),
    );
    expect(res.status).toBe(404);
  });
  test("DELETE → 200 + store.remove", async () => {
    const store = fakeStore();
    const res = await mount(() => actorWith(["delete"]), store).request(
      `/vendors/${VENDOR}/banks/${BANK}`,
      { method: "DELETE" },
    );
    expect(res.status).toBe(200);
    expect(store.calls).toContain(`remove:${BANK}`);
  });
  test("DELETE an unknown bank → 404", async () => {
    const store = fakeStore({ remove: async () => null });
    const res = await mount(() => actorWith(["delete"]), store).request(
      `/vendors/${VENDOR}/banks/${BANK}`,
      { method: "DELETE" },
    );
    expect(res.status).toBe(404);
  });
});

describe("attachments — upload (validated) + presigned read", () => {
  const upload = (file: File): RequestInit => {
    const form = new FormData();
    form.set("file", file);
    return { method: "POST", body: form };
  };

  test("201 + object stored on a valid PDF", async () => {
    const storage = fakeStorage();
    const res = await mount(() => actorWith(["edit"]), fakeStore(), storage).request(
      `/vendors/${VENDOR}/banks/attachments`,
      upload(new File([new Uint8Array([1, 2, 3])], "ktp.pdf", { type: "application/pdf" })),
    );
    expect(res.status).toBe(201);
    expect((await res.json()).file.mime).toBe("application/pdf");
    expect(storage.stored).toHaveLength(1);
  });
  test("400 on a disallowed content type, nothing stored", async () => {
    const storage = fakeStorage();
    const res = await mount(() => actorWith(["edit"]), fakeStore(), storage).request(
      `/vendors/${VENDOR}/banks/attachments`,
      upload(new File([new Uint8Array([1])], "x.exe", { type: "application/x-msdownload" })),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error.messageKey).toBe("error.file.badType");
    expect(storage.stored).toHaveLength(0);
  });
  test("upload without a file field → 400", async () => {
    const res = await mount(() => actorWith(["edit"]), fakeStore()).request(
      `/vendors/${VENDOR}/banks/attachments`,
      { method: "POST", body: new FormData() },
    );
    expect(res.status).toBe(400);
  });
  test("presign a set slot → 200 url", async () => {
    const res = await mount(() => actorWith(["view"]), fakeStore()).request(
      `/vendors/${VENDOR}/banks/${BANK}/attachments/ktp/url`,
    );
    expect(res.status).toBe(200);
    expect((await res.json()).url).toContain("vendor-banks/key.pdf");
  });
  test("presign an unset slot → 404", async () => {
    const store = fakeStore({ attachmentKey: async () => null });
    const res = await mount(() => actorWith(["view"]), store).request(
      `/vendors/${VENDOR}/banks/${BANK}/attachments/proof/url`,
    );
    expect(res.status).toBe(404);
  });
  test("presign an invalid slot name → 404", async () => {
    const res = await mount(() => actorWith(["view"]), fakeStore()).request(
      `/vendors/${VENDOR}/banks/${BANK}/attachments/nope/url`,
    );
    expect(res.status).toBe(404);
  });
});
