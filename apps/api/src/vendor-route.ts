/**
 * Vendor aggregate root — self-registration capture + submit (M3.5, #46, ADR-0004/0010/0013).
 *
 * The portal's own endpoints for the `vendors` record itself — the piece the bank (M3.2) and document
 * (M3.3) sub-resources hang off but that had no route of its own until now. Account-first, resumable
 * Draft (ADR-0004): a signed-up vendor user creates **one** Draft (owning it via `vendor_sub_users`),
 * leaves and resumes it through `GET /vendors/me`, saves partial edits leniently, and finally submits.
 *
 * Two validation stages, straight from `@vms/domain` so the portal and this route never disagree:
 *   - **save-Draft (lenient)** — {@link vendorDraftInput}: a half-filled Draft round-trips (POST/PUT).
 *   - **submit (whole-aggregate)** — {@link checkVendorSubmittable}: profile required set + banks +
 *     mandatory documents judged together. The route assembles the candidate (profile row + banks +
 *     the origin∪category required doc set from the requirements matrix + captured slots) and lets the
 *     shared gate decide; a not-ready result is one mapped 422 with the blockers as `details`.
 *
 * **Tax-ID duplicate at submit** (ADR-0004/0010): a Draft may carry a `tax_id` that already exists — the
 * `vendors_tax_id_non_draft_uq` partial index only bites once the row leaves Draft. So the collision
 * surfaces exactly at the Draft→Pending transition, where the unique-violation is caught and returned as
 * a friendly 409 (`error.vendor.taxIdDuplicate`) rather than a raw 500.
 *
 * Own-vendor scoping is enforced by {@link requireVendorOwnership} (mounted on the `:vendorId` routes);
 * RBAC gates the module verbs. Every mutation writes its audit row inside the same transaction.
 */

import {
  type DB,
  categoryDocumentRequirements,
  db as defaultDb,
  documentMaster,
  documentSlots,
  vendorBankCurrencies,
  vendorBanks,
  vendorSubUsers,
  vendors,
} from "@vms/db";
import {
  type CapturedDocument,
  type CompanyScale,
  type NpwpType,
  type Origin,
  type PaymentTerm,
  type RequestContext,
  type TaxStatus,
  type VendorBankInput,
  type VendorDraftInput,
  type VendorSource,
  type VendorSubmissionCandidate,
  checkVendorSubmittable,
  conflictError,
  invariantError,
  notFoundError,
  parseWith,
  requiredDocumentSet,
  submitReadinessError,
  validationError,
  vendorDraftInput,
} from "@vms/domain";
import { and, eq, inArray, ne } from "drizzle-orm";
import { type Context, Hono } from "hono";
import { writeAudit } from "./audit";
import type { AppEnv } from "./context";
import { sendError } from "./http-error";
import { requirePermission } from "./rbac";
import {
  type VendorMembershipStore,
  drizzleVendorMembershipStore,
  requireVendorOwnership,
} from "./vendor-access";

/** Vendor capture gates on the `vendors` RBAC module (ADR-0012); ownership is scoped separately. */
const MODULE = "vendors" as const;

/** The vendor record as the portal reads it — every editable column plus the lifecycle fields. */
export type VendorDTO = {
  readonly id: string;
  readonly origin: Origin;
  readonly status: string;
  readonly source: VendorSource;
  readonly name: string;
  readonly businessEntityId: string | null;
  readonly categoryId: string | null;
  readonly taxId: string | null;
  readonly taxStatus: TaxStatus | null;
  readonly npwpType: NpwpType | null;
  readonly companyScale: CompanyScale | null;
  readonly procurementNote: string | null;
  readonly address: string | null;
  readonly city: string | null;
  readonly postal: string | null;
  readonly countryId: string | null;
  readonly phone: string | null;
  readonly fax: string | null;
  readonly yearFounded: number | null;
  readonly website: string | null;
  readonly email: string | null;
  readonly commissioner: string | null;
  readonly director: string | null;
  readonly picName: string | null;
  readonly picRole: string | null;
  readonly picPhone: string | null;
  readonly picEmail: string | null;
  readonly soechiReference: string | null;
  readonly paymentTerm: PaymentTerm | null;
  readonly signedTermsFileId: string | null;
  readonly changePending: boolean;
};

/** The outcome of the Draft→Pending write: applied, or blocked by the tax-id partial-unique. */
export type SubmitOutcome = "submitted" | "tax_conflict";

/**
 * The data-access seam behind the router — every DB touch, so the surface is testable without Postgres.
 * The membership lookups (`owns`/existence) live in {@link VendorMembershipStore}; this store owns the
 * vendor row + the submit assembly (banks, required doc set, captured slots) + the guarded transition.
 */
export type VendorStore = {
  /** Insert a Draft (status `draft`, source `self`) and link `ownerUserId` as its owner, atomically. */
  readonly create: (
    ctx: RequestContext,
    ownerUserId: string,
    input: VendorDraftInput,
  ) => Promise<VendorDTO>;
  readonly getById: (vendorId: string) => Promise<VendorDTO | null>;
  /** Lenient partial update of a Draft's profile columns; `null` if the vendor is unknown. */
  readonly update: (
    ctx: RequestContext,
    vendorId: string,
    input: VendorDraftInput,
  ) => Promise<VendorDTO | null>;
  /** Everything the submit gate weighs beyond the profile: banks, required doc ids, captured slots. */
  readonly submissionParts: (vendor: VendorDTO) => Promise<{
    banks: VendorBankInput[];
    requiredDocMasterIds: string[];
    capturedDocuments: CapturedDocument[];
  }>;
  /** Is `taxId` already held by a *non-Draft* vendor other than `exceptVendorId`? (the dedup pre-check). */
  readonly taxIdTaken: (taxId: string, exceptVendorId: string) => Promise<boolean>;
  /** Apply Draft→Pending + audit atomically; reports the tax-id conflict rather than throwing a 500. */
  readonly submit: (ctx: RequestContext, vendorId: string) => Promise<SubmitOutcome>;
};

/* ── The real Drizzle store ─────────────────────────────────────────────────────────────────────── */

const toDTO = (row: typeof vendors.$inferSelect): VendorDTO => ({
  id: row.id,
  origin: row.origin,
  status: row.status,
  source: row.source,
  name: row.name,
  businessEntityId: row.businessEntityId,
  categoryId: row.categoryId,
  taxId: row.taxId,
  taxStatus: row.taxStatus,
  npwpType: row.npwpType,
  companyScale: row.companyScale,
  procurementNote: row.procurementNote,
  address: row.address,
  city: row.city,
  postal: row.postal,
  countryId: row.countryId,
  phone: row.phone,
  fax: row.fax,
  yearFounded: row.yearFounded,
  website: row.website,
  email: row.email,
  commissioner: row.commissioner,
  director: row.director,
  picName: row.picName,
  picRole: row.picRole,
  picPhone: row.picPhone,
  picEmail: row.picEmail,
  soechiReference: row.soechiReference,
  paymentTerm: row.paymentTerm,
  signedTermsFileId: row.signedTermsFileId,
  changePending: row.changePending,
});

/** The Draft columns a screen fills in (null out anything the payload omits — a lenient partial save). */
const profileValues = (input: VendorDraftInput) => ({
  name: input.name,
  businessEntityId: input.businessEntityId ?? null,
  categoryId: input.categoryId ?? null,
  taxId: input.taxId ?? null,
  taxStatus: input.taxStatus ?? null,
  npwpType: input.npwpType ?? null,
  companyScale: input.companyScale ?? null,
  procurementNote: input.procurementNote ?? null,
  address: input.address ?? null,
  city: input.city ?? null,
  postal: input.postal ?? null,
  countryId: input.countryId ?? null,
  phone: input.phone ?? null,
  fax: input.fax ?? null,
  yearFounded: input.yearFounded ?? null,
  website: input.website ?? null,
  email: input.email ?? null,
  commissioner: input.commissioner ?? null,
  director: input.director ?? null,
  picName: input.picName ?? null,
  picRole: input.picRole ?? null,
  picPhone: input.picPhone ?? null,
  picEmail: input.picEmail ?? null,
  soechiReference: input.soechiReference ?? null,
  paymentTerm: input.paymentTerm ?? null,
  signedTermsFileId: input.signedTermsFileId ?? null,
});

/** A Postgres unique-violation on the vendor tax-id partial index (23505 on `vendors_tax_id_...`). */
const isTaxIdConflict = (error: unknown): boolean => {
  const e = error as { code?: string; constraint_name?: string } | null;
  if (!e || e.code !== "23505") return false;
  const constraint = e.constraint_name ?? "";
  return constraint.includes("tax_id") || String(error).includes("vendors_tax_id_non_draft_uq");
};

export const drizzleVendorStore = (dbHandle: DB = defaultDb): VendorStore => ({
  create: (ctx, ownerUserId, input) =>
    dbHandle.transaction(async (tx) => {
      const [row] = await tx
        .insert(vendors)
        .values({ origin: input.origin, source: "self", status: "draft", ...profileValues(input) })
        .returning();
      if (!row) throw new Error("vendor insert returned no row");
      await tx
        .insert(vendorSubUsers)
        .values({ vendorId: row.id, userId: ownerUserId, isOwner: true });
      await writeAudit(tx, ctx, {
        action: "vendor.created",
        module: MODULE,
        subjectType: "vendor",
        subjectId: row.id,
      });
      return toDTO(row);
    }),

  getById: async (vendorId) => {
    const [row] = await dbHandle.select().from(vendors).where(eq(vendors.id, vendorId)).limit(1);
    return row ? toDTO(row) : null;
  },

  update: (ctx, vendorId, input) =>
    dbHandle.transaction(async (tx) => {
      const [row] = await tx
        .update(vendors)
        .set({ ...profileValues(input), updatedAt: new Date() })
        .where(eq(vendors.id, vendorId))
        .returning();
      if (!row) return null;
      await writeAudit(tx, ctx, {
        action: "vendor.updated",
        module: MODULE,
        subjectType: "vendor",
        subjectId: vendorId,
      });
      return toDTO(row);
    }),

  submissionParts: async (vendor) => {
    // Banks → the shape the gate reads (nulls normalised to undefined for the optional fields).
    const bankRows = await dbHandle
      .select()
      .from(vendorBanks)
      .where(eq(vendorBanks.vendorId, vendor.id));
    const currencyRows =
      bankRows.length === 0
        ? []
        : await dbHandle
            .select()
            .from(vendorBankCurrencies)
            .where(
              inArray(
                vendorBankCurrencies.vendorBankId,
                bankRows.map((b) => b.id),
              ),
            );
    const currenciesByBank = new Map<string, string[]>();
    for (const c of currencyRows) {
      const list = currenciesByBank.get(c.vendorBankId) ?? [];
      list.push(c.currencyId);
      currenciesByBank.set(c.vendorBankId, list);
    }
    const banks: VendorBankInput[] = bankRows.map((b) => ({
      bankName: b.bankName,
      accountNo: b.accountNo,
      holderName: b.holderName,
      bankId: b.bankId ?? undefined,
      branch: b.branch ?? undefined,
      description: b.description ?? undefined,
      swift: b.swift ?? undefined,
      iban: b.iban ?? undefined,
      bankCountryId: b.bankCountryId ?? undefined,
      currencyIds: currenciesByBank.get(b.id) ?? [],
      isPrimary: b.isPrimary,
      holderSameAsCompany: b.holderSameAsCompany,
      differsFromCompanyRemark: b.differsFromCompanyRemark ?? undefined,
      proofFileId: b.proofFileId ?? undefined,
      ktpFileId: b.ktpFileId ?? undefined,
      suratPernyataanFileId: b.suratPernyataanFileId ?? undefined,
    }));

    // Required doc set = origin docs ∪ this category's docs (ADR-0013), composed from the matrix.
    const masterRows = await dbHandle
      .select({
        id: documentMaster.id,
        appliesTo: documentMaster.appliesTo,
        mandatory: documentMaster.mandatory,
        enabled: documentMaster.enabled,
      })
      .from(documentMaster);
    const requirementRows = await dbHandle
      .select({
        categoryId: categoryDocumentRequirements.categoryId,
        documentMasterId: categoryDocumentRequirements.documentMasterId,
        mandatory: categoryDocumentRequirements.mandatory,
        active: categoryDocumentRequirements.active,
        enabled: documentMaster.enabled,
      })
      .from(categoryDocumentRequirements)
      .innerJoin(
        documentMaster,
        eq(categoryDocumentRequirements.documentMasterId, documentMaster.id),
      );
    const requiredDocMasterIds = requiredDocumentSet(
      { origin: vendor.origin, categoryId: vendor.categoryId },
      { master: masterRows, categoryRequirements: requirementRows },
    );

    // Captured slots → which doc types currently hold a version.
    const slotRows = await dbHandle
      .select({
        documentMasterId: documentSlots.documentMasterId,
        currentVersionId: documentSlots.currentVersionId,
      })
      .from(documentSlots)
      .where(eq(documentSlots.vendorId, vendor.id));
    const capturedDocuments: CapturedDocument[] = slotRows.map((s) => ({
      documentMasterId: s.documentMasterId,
      hasCurrentVersion: s.currentVersionId !== null,
    }));

    return { banks, requiredDocMasterIds, capturedDocuments };
  },

  taxIdTaken: async (taxId, exceptVendorId) => {
    const rows = await dbHandle
      .select({ id: vendors.id })
      .from(vendors)
      .where(and(eq(vendors.taxId, taxId), ne(vendors.status, "draft")));
    return rows.some((r) => r.id !== exceptVendorId);
  },

  submit: (ctx, vendorId) =>
    dbHandle.transaction(async (tx): Promise<SubmitOutcome> => {
      try {
        await tx
          .update(vendors)
          .set({ status: "pending", updatedAt: new Date() })
          .where(eq(vendors.id, vendorId));
      } catch (error) {
        if (isTaxIdConflict(error)) return "tax_conflict";
        throw error;
      }
      await writeAudit(tx, ctx, {
        action: "vendor.submitted",
        module: MODULE,
        subjectType: "vendor",
        subjectId: vendorId,
      });
      return "submitted";
    }),
});

/* ── Route ──────────────────────────────────────────────────────────────────────────────────────── */

/** Parse a JSON body against the lenient Draft schema, returning a `Result` (malformed JSON → 400). */
const parseDraftBody = async (c: Context<AppEnv>) => {
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    return { ok: false as const, error: validationError() };
  }
  return parseWith(vendorDraftInput, raw);
};

/**
 * Build the `/vendors` aggregate router. Stores are injectable so the whole surface is testable without
 * Postgres; defaults are the real Drizzle stores. `ownership` guards the `:vendorId` routes (a vendor
 * may only reach their own record); RBAC guards the module verbs.
 */
export const vendorRoutes = (
  store: VendorStore = drizzleVendorStore(),
  membership: VendorMembershipStore = drizzleVendorMembershipStore(),
): Hono<AppEnv> => {
  const app = new Hono<AppEnv>();
  // The aggregate's own `:vendorId` routes need ownership too — the index.ts `/:vendorId/*` wildcard
  // (which guards the bank/document sub-routers) doesn't match a bare `/vendors/:vendorId`. `/me` and
  // `POST /vendors` carry no `:vendorId`, so the guard is a no-op there.
  const ownership = requireVendorOwnership(membership);

  // Resume: the caller's own vendor (portal entry). 404 when they haven't started one yet.
  app.get("/vendors/me", requirePermission(MODULE, "view"), async (c) => {
    const actor = c.var.ctx.actor;
    if (!actor) return sendError(c, notFoundError());
    const vendorId = await membership.ownedVendorId(actor.userId);
    if (!vendorId) return sendError(c, notFoundError());
    const item = await store.getById(vendorId);
    return item ? c.json({ item }) : sendError(c, notFoundError());
  });

  // Create a Draft + own it. One registration per owner (Phase-0 single-owner) → 409 to resume.
  app.post("/vendors", requirePermission(MODULE, "add"), async (c) => {
    const actor = c.var.ctx.actor;
    if (!actor) return sendError(c, notFoundError());
    const existing = await membership.ownedVendorId(actor.userId);
    if (existing) {
      return sendError(
        c,
        conflictError({
          messageKey: "error.vendor.alreadyRegistered",
          params: { vendorId: existing },
        }),
      );
    }
    const parsed = await parseDraftBody(c);
    if (!parsed.ok) return sendError(c, parsed.error);
    const item = await store.create(c.var.ctx, actor.userId, parsed.value);
    return c.json({ item }, 201);
  });

  app.get("/vendors/:vendorId", requirePermission(MODULE, "view"), ownership, async (c) => {
    const item = await store.getById(c.req.param("vendorId"));
    return item ? c.json({ item }) : sendError(c, notFoundError());
  });

  app.put("/vendors/:vendorId", requirePermission(MODULE, "edit"), ownership, async (c) => {
    const current = await store.getById(c.req.param("vendorId"));
    if (!current) return sendError(c, notFoundError());
    if (current.status !== "draft") {
      return sendError(c, conflictError({ messageKey: "error.vendor.notDraft" }));
    }
    const parsed = await parseDraftBody(c);
    if (!parsed.ok) return sendError(c, parsed.error);
    const item = await store.update(c.var.ctx, current.id, parsed.value);
    return item ? c.json({ item }) : sendError(c, notFoundError());
  });

  // Submit: whole-aggregate gate → Draft→Pending. Not-ready = 422 (blockers in `details`); a tax-id
  // collision at the transition = 409 (friendly, linking); success returns the now-Pending record.
  app.post("/vendors/:vendorId/submit", requirePermission(MODULE, "edit"), ownership, async (c) => {
    const vendor = await store.getById(c.req.param("vendorId"));
    if (!vendor) return sendError(c, notFoundError());
    if (vendor.status !== "draft") {
      return sendError(c, conflictError({ messageKey: "error.vendor.notDraft" }));
    }
    const parts = await store.submissionParts(vendor);
    // `vendor` is a variable (not a fresh literal), so its extra lifecycle fields (id/status/…) are
    // structurally ignored; the profile half of the gate reads only the VendorDraftInput columns.
    const candidate: VendorSubmissionCandidate = {
      profile: vendor,
      banks: parts.banks,
      requiredDocMasterIds: parts.requiredDocMasterIds,
      capturedDocuments: parts.capturedDocuments,
    };
    const readiness = checkVendorSubmittable(candidate);
    if (!readiness.ok) return sendError(c, submitReadinessError(readiness));

    // Tax-ID dedup (ADR-0004): a Draft may carry a duplicate, blocked the moment it leaves Draft. The
    // deterministic pre-check gives the friendly error; the `vendors_tax_id_non_draft_uq` index below
    // is the race-safe backstop (a concurrent submit that slips past the read still 409s, not 500s).
    if (vendor.taxId && (await store.taxIdTaken(vendor.taxId, vendor.id))) {
      return sendError(c, conflictError({ messageKey: "error.vendor.taxIdDuplicate" }));
    }

    const outcome = await store.submit(c.var.ctx, vendor.id);
    if (outcome === "tax_conflict") {
      return sendError(c, conflictError({ messageKey: "error.vendor.taxIdDuplicate" }));
    }
    const item = await store.getById(vendor.id);
    return item ? c.json({ item }) : sendError(c, invariantError());
  });

  return app;
};
