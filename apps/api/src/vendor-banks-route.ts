/**
 * Vendor bank accounts + attachments (M3.2, #43, ADR-0013/0005/0007).
 *
 * The vendor-scoped sub-resource for capturing bank accounts during registration: CRUD over
 * `vendor_banks`, the M:N `vendor_bank_currencies` link, and the three MinIO **attachments** (account
 * proof, KTP-of-holder, surat pernyataan). Mounted at `/vendors/:vendorId/banks`; the aggregate root
 * (the vendor record itself) is captured by the portal/office screens in M3.5/M3.6 — here we only own
 * the bank block, which those screens and the M3.4 submit gate all read through `@vms/domain`.
 *
 * Three invariants are enforced, each where it can actually be checked:
 *   - **Exactly one primary** — a *set*-level rule, reconciled inside the store's transaction on every
 *     write (promote-on-first, demote-others-on-promote, promote-oldest-on-delete) and backed by the
 *     `vendor_banks_one_primary_uq` partial index. The API never lets a vendor's set drift off it.
 *   - **holder ≠ company ⇒ KTP + surat** — a per-account rule (ADR-0007), enforced here as a 422 via the
 *     shared `missingHolderProof` predicate. The capture flow uploads first (getting file ids back),
 *     then saves the account carrying those ids, so the proof is present by save time.
 *   - **bank country ≠ vendor country ⇒ remark** — needs the vendor's own country, so it's checked here
 *     (not in the self-contained schema) against the vendor row, also as a 422 (ADR-0005).
 *
 * Attachments are **validated, not gated** (ADR-0013): {@link uploadFile} rejects a wrong type / oversize
 * file before storing it; reads are short-lived **signed URLs** the browser fetches straight from MinIO.
 */

import { db as defaultDb, files, vendorBankCurrencies, vendorBanks, vendors } from "@vms/db";
import {
  type RequestContext,
  type VendorBankInput,
  type VendorStatus,
  bankCountryRemarkRequired,
  conflictError,
  invariantError,
  isCaptureEditable,
  missingHolderProof,
  notFoundError,
  parseWith,
  validationError,
  vendorBankInput,
} from "@vms/domain";
import { and, asc, eq, inArray } from "drizzle-orm";
import { type Context, Hono } from "hono";
import { writeAudit } from "./audit";
import type { AppEnv } from "./context";
import { sendError } from "./http-error";
import { requirePermission } from "./rbac";
import { type AttachmentStorage, attachmentStorage } from "./storage";

/** Bank capture is part of vendor registration — it gates on the `vendors` RBAC module (ADR-0012). */
const MODULE = "vendors" as const;

/** One bank account as returned to the client — the row plus its resolved currency ids. */
export type VendorBankDTO = {
  readonly id: string;
  readonly vendorId: string;
  readonly bankId: string | null;
  readonly bankName: string;
  readonly accountNo: string;
  readonly holderName: string;
  readonly branch: string | null;
  readonly description: string | null;
  readonly swift: string | null;
  readonly iban: string | null;
  readonly bankCountryId: string | null;
  readonly isPrimary: boolean;
  readonly holderSameAsCompany: boolean;
  readonly differsFromCompanyRemark: string | null;
  readonly proofFileId: string | null;
  readonly ktpFileId: string | null;
  readonly suratPernyataanFileId: string | null;
  readonly currencyIds: string[];
};

/** Just enough of the vendor to run the invariants: does it exist, and what's its country? */
export type VendorRef = {
  readonly id: string;
  readonly countryId: string | null;
  /** Lifecycle status — bank capture is frozen once the vendor leaves Draft (M4.4, ADR-0014). */
  readonly status: VendorStatus;
};

/**
 * The data-access seam behind the router — every DB touch, so the route is testable with a fake. The
 * store owns the one-primary reconciliation and the atomic audit; the route owns the holder/remark
 * invariants (which it can check before touching the store).
 */
export type VendorBankStore = {
  /** Resolve the owning vendor (existence + country for the remark rule), or `null` if unknown. */
  readonly getVendor: (vendorId: string) => Promise<VendorRef | null>;
  readonly list: (vendorId: string) => Promise<VendorBankDTO[]>;
  readonly create: (
    ctx: RequestContext,
    vendorId: string,
    input: VendorBankInput,
  ) => Promise<VendorBankDTO>;
  readonly update: (
    ctx: RequestContext,
    vendorId: string,
    bankId: string,
    input: VendorBankInput,
  ) => Promise<VendorBankDTO | null>;
  readonly remove: (
    ctx: RequestContext,
    vendorId: string,
    bankId: string,
  ) => Promise<VendorBankDTO | null>;
  /** The object key for a bank's attachment slot (for presigning a read), or `null` if unset/unknown. */
  readonly attachmentKey: (
    vendorId: string,
    bankId: string,
    slot: AttachmentSlot,
  ) => Promise<string | null>;
};

/** The three attachment slots → their `vendor_banks` file-id column. */
const SLOT_COLUMN = {
  proof: vendorBanks.proofFileId,
  ktp: vendorBanks.ktpFileId,
  surat: vendorBanks.suratPernyataanFileId,
} as const;
export type AttachmentSlot = keyof typeof SLOT_COLUMN;
const isSlot = (s: string): s is AttachmentSlot => s in SLOT_COLUMN;

/* ── The real Drizzle store ─────────────────────────────────────────────────────────────────────── */

const toDTO = (row: typeof vendorBanks.$inferSelect, currencyIds: string[]): VendorBankDTO => ({
  id: row.id,
  vendorId: row.vendorId,
  bankId: row.bankId,
  bankName: row.bankName,
  accountNo: row.accountNo,
  holderName: row.holderName,
  branch: row.branch,
  description: row.description,
  swift: row.swift,
  iban: row.iban,
  bankCountryId: row.bankCountryId,
  isPrimary: row.isPrimary,
  holderSameAsCompany: row.holderSameAsCompany,
  differsFromCompanyRemark: row.differsFromCompanyRemark,
  proofFileId: row.proofFileId,
  ktpFileId: row.ktpFileId,
  suratPernyataanFileId: row.suratPernyataanFileId,
  currencyIds,
});

/** Columns written from the capture input (everything except the primary flag + currencies). */
export const bankValues = (vendorId: string, input: VendorBankInput) => ({
  vendorId,
  bankId: input.bankId ?? null,
  bankName: input.bankName,
  accountNo: input.accountNo,
  holderName: input.holderName,
  branch: input.branch ?? null,
  description: input.description ?? null,
  swift: input.swift ?? null,
  iban: input.iban ?? null,
  bankCountryId: input.bankCountryId ?? null,
  holderSameAsCompany: input.holderSameAsCompany,
  differsFromCompanyRemark: input.differsFromCompanyRemark ?? null,
  proofFileId: input.proofFileId ?? null,
  ktpFileId: input.ktpFileId ?? null,
  suratPernyataanFileId: input.suratPernyataanFileId ?? null,
});

export const drizzleVendorBankStore = (dbHandle = defaultDb): VendorBankStore => {
  /** All currency ids for a set of bank ids, grouped by bank id. */
  const currenciesFor = async (
    handle: typeof defaultDb,
    bankIds: string[],
  ): Promise<Map<string, string[]>> => {
    const grouped = new Map<string, string[]>();
    if (bankIds.length === 0) return grouped;
    const rows = await handle
      .select()
      .from(vendorBankCurrencies)
      .where(inArray(vendorBankCurrencies.vendorBankId, bankIds));
    for (const r of rows) {
      const list = grouped.get(r.vendorBankId) ?? [];
      list.push(r.currencyId);
      grouped.set(r.vendorBankId, list);
    }
    return grouped;
  };

  return {
    getVendor: async (vendorId) => {
      const [row] = await dbHandle
        .select({ id: vendors.id, countryId: vendors.countryId, status: vendors.status })
        .from(vendors)
        .where(eq(vendors.id, vendorId))
        .limit(1);
      return row ?? null;
    },

    list: async (vendorId) => {
      const rows = await dbHandle
        .select()
        .from(vendorBanks)
        .where(eq(vendorBanks.vendorId, vendorId))
        .orderBy(asc(vendorBanks.createdAt));
      const currencies = await currenciesFor(
        dbHandle,
        rows.map((r) => r.id),
      );
      return rows.map((r) => toDTO(r, currencies.get(r.id) ?? []));
    },

    create: (ctx, vendorId, input) =>
      dbHandle.transaction(async (tx) => {
        // First account for a vendor is always primary; otherwise honour the flag. Promoting one
        // demotes the rest first, so the partial-unique index never sees two primaries mid-transaction.
        const existing = await tx
          .select({ id: vendorBanks.id })
          .from(vendorBanks)
          .where(eq(vendorBanks.vendorId, vendorId));
        const primary = existing.length === 0 ? true : (input.isPrimary ?? false);
        if (primary && existing.length > 0) {
          await tx
            .update(vendorBanks)
            .set({ isPrimary: false, updatedAt: new Date() })
            .where(and(eq(vendorBanks.vendorId, vendorId), eq(vendorBanks.isPrimary, true)));
        }
        const [row] = await tx
          .insert(vendorBanks)
          .values({ ...bankValues(vendorId, input), isPrimary: primary })
          .returning();
        if (!row) throw new Error("vendor_bank insert returned no row");
        if (input.currencyIds.length > 0) {
          await tx
            .insert(vendorBankCurrencies)
            .values(input.currencyIds.map((currencyId) => ({ vendorBankId: row.id, currencyId })));
        }
        await writeAudit(tx, ctx, {
          action: "vendor_bank.created",
          module: MODULE,
          subjectType: "vendor_bank",
          subjectId: row.id,
        });
        return toDTO(row, [...input.currencyIds]);
      }),

    update: (ctx, vendorId, bankId, input) =>
      dbHandle.transaction(async (tx) => {
        const [exists] = await tx
          .select({ id: vendorBanks.id })
          .from(vendorBanks)
          .where(and(eq(vendorBanks.id, bankId), eq(vendorBanks.vendorId, vendorId)))
          .limit(1);
        if (!exists) return null;
        // Primary is only ever *promoted* here (demoting others first); an explicit `false` is ignored,
        // since the way to move the primary is to promote a different account — never to leave zero.
        const promote = input.isPrimary === true;
        if (promote) {
          await tx
            .update(vendorBanks)
            .set({ isPrimary: false, updatedAt: new Date() })
            .where(and(eq(vendorBanks.vendorId, vendorId), eq(vendorBanks.isPrimary, true)));
        }
        const [row] = await tx
          .update(vendorBanks)
          .set({
            ...bankValues(vendorId, input),
            ...(promote ? { isPrimary: true } : {}),
            updatedAt: new Date(),
          })
          .where(eq(vendorBanks.id, bankId))
          .returning();
        // Replace the currency set wholesale (the input carries the full desired set).
        await tx.delete(vendorBankCurrencies).where(eq(vendorBankCurrencies.vendorBankId, bankId));
        if (input.currencyIds.length > 0) {
          await tx
            .insert(vendorBankCurrencies)
            .values(input.currencyIds.map((currencyId) => ({ vendorBankId: bankId, currencyId })));
        }
        await writeAudit(tx, ctx, {
          action: "vendor_bank.updated",
          module: MODULE,
          subjectType: "vendor_bank",
          subjectId: bankId,
        });
        return toDTO(row, [...input.currencyIds]);
      }),

    remove: (ctx, vendorId, bankId) =>
      dbHandle.transaction(async (tx) => {
        const [row] = await tx
          .select()
          .from(vendorBanks)
          .where(and(eq(vendorBanks.id, bankId), eq(vendorBanks.vendorId, vendorId)))
          .limit(1);
        if (!row) return null;
        const curRows = await tx
          .select()
          .from(vendorBankCurrencies)
          .where(eq(vendorBankCurrencies.vendorBankId, bankId));
        const removedCurrencyIds = curRows.map((r) => r.currencyId);
        await tx.delete(vendorBanks).where(eq(vendorBanks.id, bankId)); // currencies cascade
        // Deleting the primary would leave the set with none — promote the oldest remaining account.
        if (row.isPrimary) {
          const [next] = await tx
            .select({ id: vendorBanks.id })
            .from(vendorBanks)
            .where(eq(vendorBanks.vendorId, vendorId))
            .orderBy(asc(vendorBanks.createdAt))
            .limit(1);
          if (next) {
            await tx
              .update(vendorBanks)
              .set({ isPrimary: true, updatedAt: new Date() })
              .where(eq(vendorBanks.id, next.id));
          }
        }
        await writeAudit(tx, ctx, {
          action: "vendor_bank.deleted",
          module: MODULE,
          subjectType: "vendor_bank",
          subjectId: bankId,
        });
        return toDTO(row, removedCurrencyIds);
      }),

    attachmentKey: async (vendorId, bankId, slot) => {
      const [row] = await dbHandle
        .select({ fileId: SLOT_COLUMN[slot] })
        .from(vendorBanks)
        .where(and(eq(vendorBanks.id, bankId), eq(vendorBanks.vendorId, vendorId)))
        .limit(1);
      if (!row?.fileId) return null;
      const [file] = await dbHandle
        .select({ objectKey: files.objectKey })
        .from(files)
        .where(eq(files.id, row.fileId))
        .limit(1);
      return file?.objectKey ?? null;
    },
  };
};

/* ── Route ──────────────────────────────────────────────────────────────────────────────────────── */

/**
 * The freeze 409 (M4.4, ADR-0014): once a vendor leaves Draft its banks are immutable — the same
 * `notDraft` invariant the profile edit gate returns, so capture messaging stays identical across
 * profile/banks/documents. Change then goes through recall or an approver's rejection.
 */
const frozenError = () => conflictError({ messageKey: "error.vendor.notDraft" });

/**
 * Enforce the two per-account business invariants the schema can't (one needs the vendor country). A
 * returned error is a 422; `null` means the account is sound. Reused by create + update.
 */
const bankInvariant = (input: VendorBankInput, vendor: VendorRef) => {
  if (missingHolderProof(input).ktp || missingHolderProof(input).surat) {
    return invariantError({ messageKey: "error.bank.holderProofRequired" });
  }
  if (
    bankCountryRemarkRequired(input.bankCountryId, vendor.countryId ?? undefined) &&
    !input.differsFromCompanyRemark
  ) {
    return invariantError({ messageKey: "error.bank.countryRemarkRequired" });
  }
  return null;
};

/**
 * Parse + validate a JSON bank body against the shared schema, returning a `Result`. A malformed JSON
 * body is a plain validation error; a schema failure carries the Zod issues. Callers turn either into
 * the HTTP response, then run {@link bankInvariant} for the business rules the schema can't express.
 */
const parseBankBody = async (c: Context<AppEnv>) => {
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    return { ok: false as const, error: validationError() };
  }
  return parseWith(vendorBankInput, raw);
};

/**
 * Build the `/vendors/:vendorId/banks` router. Stores are injectable so the whole surface is testable
 * without Postgres or MinIO; the defaults are the real Drizzle store + Bun S3 file store.
 */
export const vendorBanksRoutes = (
  store: VendorBankStore = drizzleVendorBankStore(),
  storage: AttachmentStorage = attachmentStorage(),
): Hono<AppEnv> => {
  const app = new Hono<AppEnv>();

  // Upload one attachment (validated, not gated) → returns the file id to link onto a bank account.
  // Declared before `/:bankId` paths so `attachments` isn't captured as a bank id.
  app.post("/:vendorId/banks/attachments", requirePermission(MODULE, "edit"), async (c) => {
    const vendor = await store.getVendor(c.req.param("vendorId"));
    if (!vendor) return sendError(c, notFoundError());
    if (!isCaptureEditable(vendor.status)) return sendError(c, frozenError());
    let body: Record<string, unknown>;
    try {
      body = await c.req.parseBody();
    } catch {
      return sendError(c, validationError());
    }
    const file = body.file;
    if (!(file instanceof File)) {
      return sendError(c, validationError({ messageKey: "error.file.empty" }));
    }
    const result = await storage.upload({
      bytes: new Uint8Array(await file.arrayBuffer()),
      mime: file.type,
      sizeBytes: file.size,
      originalName: file.name,
      uploadedBy: c.var.ctx.actor?.userId,
    });
    if (!result.ok) return sendError(c, result.error);
    return c.json({ file: result.value }, 201);
  });

  // Presign a read of a bank's attachment slot (proof | ktp | surat).
  app.get(
    "/:vendorId/banks/:bankId/attachments/:slot/url",
    requirePermission(MODULE, "view"),
    async (c) => {
      const slot = c.req.param("slot");
      if (!isSlot(slot)) return sendError(c, notFoundError());
      const key = await store.attachmentKey(c.req.param("vendorId"), c.req.param("bankId"), slot);
      if (!key) return sendError(c, notFoundError());
      return c.json({ url: await storage.presignGet(key) });
    },
  );

  app.get("/:vendorId/banks", requirePermission(MODULE, "view"), async (c) => {
    const vendor = await store.getVendor(c.req.param("vendorId"));
    if (!vendor) return sendError(c, notFoundError());
    return c.json({ items: await store.list(c.req.param("vendorId")) });
  });

  app.post("/:vendorId/banks", requirePermission(MODULE, "add"), async (c) => {
    const vendor = await store.getVendor(c.req.param("vendorId"));
    if (!vendor) return sendError(c, notFoundError());
    if (!isCaptureEditable(vendor.status)) return sendError(c, frozenError());
    const parsed = await parseBankBody(c);
    if (!parsed.ok) return sendError(c, parsed.error);
    const bad = bankInvariant(parsed.value, vendor);
    if (bad) return sendError(c, bad);
    return c.json({ item: await store.create(c.var.ctx, vendor.id, parsed.value) }, 201);
  });

  app.put("/:vendorId/banks/:bankId", requirePermission(MODULE, "edit"), async (c) => {
    const vendor = await store.getVendor(c.req.param("vendorId"));
    if (!vendor) return sendError(c, notFoundError());
    if (!isCaptureEditable(vendor.status)) return sendError(c, frozenError());
    const parsed = await parseBankBody(c);
    if (!parsed.ok) return sendError(c, parsed.error);
    const bad = bankInvariant(parsed.value, vendor);
    if (bad) return sendError(c, bad);
    const item = await store.update(c.var.ctx, vendor.id, c.req.param("bankId"), parsed.value);
    return item === null ? sendError(c, notFoundError()) : c.json({ item });
  });

  app.delete("/:vendorId/banks/:bankId", requirePermission(MODULE, "delete"), async (c) => {
    const vendor = await store.getVendor(c.req.param("vendorId"));
    if (!vendor) return sendError(c, notFoundError());
    if (!isCaptureEditable(vendor.status)) return sendError(c, frozenError());
    const item = await store.remove(c.var.ctx, c.req.param("vendorId"), c.req.param("bankId"));
    return item === null ? sendError(c, notFoundError()) : c.json({ item });
  });

  return app;
};
