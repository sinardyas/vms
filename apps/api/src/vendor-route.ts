/**
 * Vendor aggregate root — self-registration + office registration capture + submit (M3.5/M3.6, #46/#47,
 * ADR-0004/0009/0010/0013).
 *
 * The `vendors` record's own endpoints — the piece the bank (M3.2) and document (M3.3) sub-resources hang
 * off but that had no route of its own until M3.5. One `POST /vendors`, two audiences (ADR-0004, keyed on
 * the actor's `kind`):
 *   - **self** (portal, vendor-kind) — account-first, resumable Draft: a signed-up vendor creates **one**
 *     Draft (owning it via `vendor_sub_users`), resumes it through `GET /vendors/me`, then submits →
 *     `pending`.
 *   - **office** (console, internal-kind, M3.6) — staff register a vendor **on-behalf**: `source=office`,
 *     no owner link, no one-per-owner cap (staff register many), attributed to the acting staff by audit;
 *     submit routes to a separate HOD approval → `pending_hod` (ADR-0009 `office_vendor_registration`).
 * Both save partial edits leniently and run the *same* M3.4 gate — the paths can never disagree on the bar.
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
  approvalRequestSteps,
  approvalRequests,
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
  type VendorProfileChangeInput,
  type VendorSource,
  type VendorSubmissionCandidate,
  checkVendorSubmittable,
  conflictError,
  invariantError,
  isRecallable,
  notFoundError,
  parseWith,
  requiredDocumentSet,
  submitReadinessError,
  validationError,
  vendorDraftInput,
} from "@vms/domain";
import { and, desc, eq, inArray, ne } from "drizzle-orm";
import { type Context, Hono } from "hono";
import { isOnePendingChange, openApprovalRequest } from "./approval-engine";
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

/**
 * The outcome of the Draft→Pending write: applied, blocked by the tax-id partial-unique, or blocked by
 * the one-pending-change lock (the vendor already carries an open request — ADR-0010).
 */
export type SubmitOutcome = "submitted" | "tax_conflict" | "change_pending";

/**
 * The outcome of a submitter recall (Pending→Draft, ADR-0010): withdrawn, or refused because the vendor
 * isn't under review (`not_pending`) or review has already started (`already_decided`).
 */
export type RecallOutcome = "recalled" | "not_pending" | "already_decided";

/**
 * A vendor as the console **list** renders it (M3.7): just enough to search, badge, and open a row —
 * name + origin/status/source + the tax-id and the category/country ids the screen resolves to labels
 * off the masters it already loads. The full record comes from `GET /vendors/:id` when a row is opened.
 */
export type VendorSummaryDTO = {
  readonly id: string;
  readonly name: string;
  readonly origin: Origin;
  readonly status: string;
  readonly source: VendorSource;
  readonly taxId: string | null;
  readonly categoryId: string | null;
  readonly countryId: string | null;
  readonly changePending: boolean;
};

/**
 * One mandatory document the vendor must supply, as the portal doc section renders it. Portal-scoped
 * (gated `vendors:view` + ownership) because the vendor role can't read the `document_master` module —
 * so the required set + its bilingual labels are surfaced here rather than from the console masters.
 */
export type RequiredDocumentDTO = {
  readonly documentMasterId: string;
  readonly no: string;
  readonly nameId: string;
  readonly nameEn: string;
  readonly captured: boolean;
};

/**
 * The data-access seam behind the router — every DB touch, so the surface is testable without Postgres.
 * The membership lookups (`owns`/existence) live in {@link VendorMembershipStore}; this store owns the
 * vendor row + the submit assembly (banks, required doc set, captured slots) + the guarded transition.
 */
export type VendorStore = {
  /**
   * Insert a Draft (status `draft`) with the given `source`, atomically. When `ownerUserId` is set (the
   * portal self-registration path) the user is linked as the vendor's owner via `vendor_sub_users`;
   * `null` (the office on-behalf path) creates the Draft with no owner link.
   */
  readonly create: (
    ctx: RequestContext,
    input: VendorDraftInput,
    opts: { source: VendorSource; ownerUserId: string | null },
  ) => Promise<VendorDTO>;
  readonly getById: (vendorId: string) => Promise<VendorDTO | null>;
  /** Every vendor as a list summary, newest first — the console browse surface (M3.7). */
  readonly list: () => Promise<VendorSummaryDTO[]>;
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
  /** The mandatory documents this vendor must supply (origin∪category), each flagged captured-or-not. */
  readonly requiredDocuments: (vendor: VendorDTO) => Promise<RequiredDocumentDTO[]>;
  /** Is `taxId` already held by a *non-Draft* vendor other than `exceptVendorId`? (the dedup pre-check). */
  readonly taxIdTaken: (taxId: string, exceptVendorId: string) => Promise<boolean>;
  /**
   * Apply Draft→`targetStatus` (`pending` for self, `pending_hod` for office) + audit atomically;
   * reports the tax-id conflict and the one-pending-change lock rather than throwing a 500.
   */
  readonly submit: (
    ctx: RequestContext,
    vendorId: string,
    targetStatus: "pending" | "pending_hod",
  ) => Promise<SubmitOutcome>;
  /**
   * Submitter recall (ADR-0010): withdraw a Pending request back to Draft, but only *before any step is
   * decided*. Resolves the open request `recalled`, returns the vendor to `draft`, and audits both — all
   * atomically. Refuses (`not_pending` / `already_decided`) rather than mutating when the window is shut.
   */
  readonly recall: (ctx: RequestContext, vendorId: string) => Promise<RecallOutcome>;
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

/**
 * The Draft columns a screen fills in (null out anything the payload omits — a lenient partial save).
 * Reads no lifecycle fields (`origin`/`source`/`status`), so a post-activation non-bank change payload
 * ({@link VendorProfileChangeInput}, which omits those) applies through the same mapping (M4.5).
 */
export const profileValues = (input: VendorProfileChangeInput) => ({
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
  create: (ctx, input, opts) =>
    dbHandle.transaction(async (tx) => {
      const [row] = await tx
        .insert(vendors)
        .values({
          origin: input.origin,
          source: opts.source,
          status: "draft",
          ...profileValues(input),
        })
        .returning();
      if (!row) throw new Error("vendor insert returned no row");
      // Portal (self) links the signed-up user as owner; office (on-behalf) has no owner link.
      if (opts.ownerUserId) {
        await tx
          .insert(vendorSubUsers)
          .values({ vendorId: row.id, userId: opts.ownerUserId, isOwner: true });
      }
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

  list: async () => {
    const rows = await dbHandle
      .select({
        id: vendors.id,
        name: vendors.name,
        origin: vendors.origin,
        status: vendors.status,
        source: vendors.source,
        taxId: vendors.taxId,
        categoryId: vendors.categoryId,
        countryId: vendors.countryId,
        changePending: vendors.changePending,
      })
      .from(vendors)
      .orderBy(desc(vendors.createdAt));
    return rows;
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

  requiredDocuments: async (vendor) => {
    const masterRows = await dbHandle
      .select({
        id: documentMaster.id,
        no: documentMaster.no,
        nameId: documentMaster.nameId,
        nameEn: documentMaster.nameEn,
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
    const requiredIds = requiredDocumentSet(
      { origin: vendor.origin, categoryId: vendor.categoryId },
      { master: masterRows, categoryRequirements: requirementRows },
    );
    const byId = new Map(masterRows.map((m) => [m.id, m]));
    const slotRows = await dbHandle
      .select({
        documentMasterId: documentSlots.documentMasterId,
        currentVersionId: documentSlots.currentVersionId,
      })
      .from(documentSlots)
      .where(eq(documentSlots.vendorId, vendor.id));
    const captured = new Set(
      slotRows.filter((s) => s.currentVersionId !== null).map((s) => s.documentMasterId),
    );
    return requiredIds.flatMap((id) => {
      const m = byId.get(id);
      return m
        ? [
            {
              documentMasterId: id,
              no: m.no,
              nameId: m.nameId,
              nameEn: m.nameEn,
              captured: captured.has(id),
            },
          ]
        : [];
    });
  },

  taxIdTaken: async (taxId, exceptVendorId) => {
    const rows = await dbHandle
      .select({ id: vendors.id })
      .from(vendors)
      .where(and(eq(vendors.taxId, taxId), ne(vendors.status, "draft")));
    return rows.some((r) => r.id !== exceptVendorId);
  },

  submit: (ctx, vendorId, targetStatus) =>
    dbHandle.transaction(async (tx): Promise<SubmitOutcome> => {
      try {
        await tx
          .update(vendors)
          .set({ status: targetStatus, updatedAt: new Date() })
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
      // Open the approval request that drives this submission through its route (M4.2, ADR-0005), in the
      // same transaction as the transition — a vendor can't reach Pending without its workflow, and a
      // failure here rolls the transition back. The trigger follows the target queue (ADR-0009): office
      // → the HOD route (`pending_hod`), self → the standard AP route (`pending`).
      const trigger =
        targetStatus === "pending_hod" ? "office_vendor_registration" : "new_vendor_registration";
      try {
        await openApprovalRequest(tx, ctx, {
          vendorId,
          trigger,
          submitterUserId: ctx.actor?.userId ?? null,
        });
      } catch (error) {
        // The one-pending-change lock (ADR-0010): the vendor already carries an open request. Surface a
        // friendly 409 and roll back the transition rather than 500 on the raw partial-index violation.
        if (isOnePendingChange(error)) return "change_pending";
        throw error;
      }
      return "submitted";
    }),

  recall: (ctx, vendorId) =>
    dbHandle.transaction(async (tx): Promise<RecallOutcome> => {
      // Only a vendor still under review can be recalled (Draft/Active have nothing to withdraw).
      const [vendor] = await tx
        .select({ status: vendors.status })
        .from(vendors)
        .where(eq(vendors.id, vendorId))
        .limit(1);
      if (!vendor || (vendor.status !== "pending" && vendor.status !== "pending_hod")) {
        return "not_pending";
      }

      // The vendor's open request + its steps' decisions — the pre-decision window (ADR-0010).
      const [request] = await tx
        .select({ id: approvalRequests.id, status: approvalRequests.status })
        .from(approvalRequests)
        .where(
          and(
            eq(approvalRequests.subjectVendorId, vendorId),
            eq(approvalRequests.status, "pending"),
          ),
        )
        .limit(1);
      if (!request) return "not_pending";
      const stepRows = await tx
        .select({ decision: approvalRequestSteps.decision })
        .from(approvalRequestSteps)
        .where(eq(approvalRequestSteps.requestId, request.id));
      if (
        !isRecallable(
          request.status,
          stepRows.map((s) => s.decision),
        )
      ) {
        return "already_decided";
      }

      const now = new Date();
      await tx
        .update(approvalRequests)
        .set({ status: "recalled", resolvedAt: now, updatedAt: now })
        .where(eq(approvalRequests.id, request.id));
      await tx
        .update(vendors)
        .set({ status: "draft", updatedAt: now })
        .where(eq(vendors.id, vendorId));
      await writeAudit(tx, ctx, {
        action: "approval_request.recalled",
        module: "approvals",
        subjectType: "approval_request",
        subjectId: request.id,
      });
      await writeAudit(tx, ctx, {
        action: "vendor.recalled",
        module: MODULE,
        subjectType: "vendor",
        subjectId: vendorId,
      });
      return "recalled";
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

  // Create a Draft. The actor's `kind` picks the audience (ADR-0004): a **vendor** self-registers —
  // exactly one owned Draft (Phase-0 single-owner) → 409 to resume the existing one; **internal** staff
  // register on-behalf (M3.6) — `source=office`, no owner link, and many are allowed (no one-per-owner).
  // The server sets `source` from the actor kind, never from the client, so the audience can't be forged.
  app.post("/vendors", requirePermission(MODULE, "add"), async (c) => {
    const actor = c.var.ctx.actor;
    if (!actor) return sendError(c, notFoundError());
    const parsed = await parseDraftBody(c);
    if (!parsed.ok) return sendError(c, parsed.error);

    if (actor.kind === "vendor") {
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
      const item = await store.create(c.var.ctx, parsed.value, {
        source: "self",
        ownerUserId: actor.userId,
      });
      return c.json({ item }, 201);
    }

    const item = await store.create(c.var.ctx, parsed.value, {
      source: "office",
      ownerUserId: null,
    });
    return c.json({ item }, 201);
  });

  // The console vendor **list** (M3.7). A staff (internal) actor browses every vendor; a vendor-kind
  // actor — who has no console but does hold `vendors:view` — is scoped to the one record they own, so
  // the list can never leak other vendors' registrations to a portal user. The portal itself resumes
  // through `GET /vendors/me` and never calls this.
  app.get("/vendors", requirePermission(MODULE, "view"), async (c) => {
    const actor = c.var.ctx.actor;
    if (!actor) return sendError(c, notFoundError());
    const items = await store.list();
    if (actor.kind === "vendor") {
      const ownedId = await membership.ownedVendorId(actor.userId);
      return c.json({ items: items.filter((v) => v.id === ownedId) });
    }
    return c.json({ items });
  });

  app.get("/vendors/:vendorId", requirePermission(MODULE, "view"), ownership, async (c) => {
    const item = await store.getById(c.req.param("vendorId"));
    return item ? c.json({ item }) : sendError(c, notFoundError());
  });

  // The mandatory documents this vendor must supply — portal-scoped so the doc section can render its
  // cards without the `document_master` grant the console has (and the portal owner lacks).
  app.get(
    "/vendors/:vendorId/required-documents",
    requirePermission(MODULE, "view"),
    ownership,
    async (c) => {
      const vendor = await store.getById(c.req.param("vendorId"));
      if (!vendor) return sendError(c, notFoundError());
      return c.json({ items: await store.requiredDocuments(vendor) });
    },
  );

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

    // Route to the right approval queue by source (ADR-0009): office registrations go to HOD
    // (`pending_hod`), self-registrations to the standard AP queue (`pending`). Same gate, one transition.
    const targetStatus = vendor.source === "office" ? "pending_hod" : "pending";
    const outcome = await store.submit(c.var.ctx, vendor.id, targetStatus);
    if (outcome === "tax_conflict") {
      return sendError(c, conflictError({ messageKey: "error.vendor.taxIdDuplicate" }));
    }
    if (outcome === "change_pending") {
      return sendError(c, conflictError({ messageKey: "error.approval.changePending" }));
    }
    const item = await store.getById(vendor.id);
    return item ? c.json({ item }) : sendError(c, invariantError());
  });

  // Recall (ADR-0010): the submitter withdraws a Pending registration back to Draft to edit + resubmit —
  // allowed only before any step is decided. Ownership-scoped (the submitter acts on their own vendor);
  // after the first decision, review "locks in" and change goes through an approver's rejection instead.
  app.post("/vendors/:vendorId/recall", requirePermission(MODULE, "edit"), ownership, async (c) => {
    const vendor = await store.getById(c.req.param("vendorId"));
    if (!vendor) return sendError(c, notFoundError());
    const outcome = await store.recall(c.var.ctx, vendor.id);
    if (outcome === "not_pending") {
      return sendError(c, conflictError({ messageKey: "error.approval.notRecallable" }));
    }
    if (outcome === "already_decided") {
      return sendError(c, conflictError({ messageKey: "error.approval.recallAfterDecision" }));
    }
    const item = await store.getById(vendor.id);
    return item ? c.json({ item }) : sendError(c, invariantError());
  });

  return app;
};
