/**
 * Compliance-document verification — the verifier's queue + per-document actions (M5.1, #68,
 * ADR-0007/0013/0014).
 *
 * The Document Verifier's own review surface, distinct from the vendor-owned capture route (M3.3,
 * `vendor-documents-route.ts`): capture uploads versions under the `vendors` module; **verification**
 * decides them under the `documents` module (`documents:approve` = the verifier role, SoD-distinct from
 * `approvals:approve` — a verifier can't approve, an approver can't verify, enforced purely by which verb
 * each role holds, M1.6/ADR-0014). Mounted at `/console/document-verification`, RBAC-gated, every decision
 * atomically audited — mirroring how `/console/approvals` (M4.2) is shaped.
 *
 * **What a decision does (this milestone):** verify a version → `verified` + stamp the verifier + record
 * the certificate's issue/expiry dates (entered or confirmed now — capture deliberately left them to the
 * verifier, ADR-0010); reject → `rejected` + reason. Decisions act **only on documents of vendors under
 * review (Pending)** and **only on a slot's current version** (a superseded version is history); a version
 * already decided is terminal — a re-upload makes a fresh `pending` version (the pure `isVersionDecidable`
 * guard, {@link @vms/domain}).
 *
 * **Reject → Draft + versioning (M5.3, #70, ADR-0011/0014):** rejecting a **mandatory** doc (one in the
 * vendor's required set, origin ∪ single-category — the same set the M5.2 gate waits on) also returns the
 * registration to Draft: it resolves the vendor's open request `rejected` and bounces the vendor to
 * `draft` (the M4.2 `return_to_draft` effect, reached from the verify path), all in the reject's own
 * transaction. Rejecting an **optional** doc does not bounce — but it still notifies: the
 * {@link VerificationNotifier} seam, a no-op through M5.3, now delivers for real (M6.2) on *every*
 * rejection, the bounce merely choosing which copy the vendor reads. Re-upload is the M3.3 capture path (pointer moves, history kept); the
 * new version starts `pending`, so a corrected doc must be re-verified — no code here, that path already
 * exists once the vendor is back in Draft.
 *
 * **Scope boundary:** the all-mandatory-Verified **activation gate** at the final-approval effect is
 * **M5.2** (this surface only *sets* the verify state both it and M5.3 read); the console screen + doc
 * viewer are **M5.4**. A `documents`-gated presign is included here so the verifier (who doesn't hold
 * `vendors:view`) can fetch a document to judge it — the M5.4 viewer builds on it.
 *
 * Stores + storage are injectable so the whole surface is testable without Postgres or MinIO.
 */

import {
  type DB,
  approvalRequests,
  db as defaultDb,
  documentMaster,
  documentSlots,
  documentVersions,
  files,
  vendors,
} from "@vms/db";
import {
  type RejectDocumentInput,
  type RequestContext,
  type VerifyDocumentInput,
  conflictError,
  isVersionDecidable,
  notFoundError,
  parseWith,
  rejectDocumentInput,
  validationError,
  verifyDocumentInput,
} from "@vms/domain";
import { and, desc, eq } from "drizzle-orm";
import { Hono } from "hono";
import { writeAudit } from "./audit";
import type { AppEnv } from "./context";
import { env } from "./env";
import { sendError } from "./http-error";
import { notificationReader, notifyDocRejected } from "./notification-events";
import { requirePermission } from "./rbac";
import { requiredDocMasterIdsForVendor } from "./required-documents";
import { type AttachmentStorage, attachmentStorage } from "./storage";

/** Verification is its own RBAC module — the verifier holds `documents`, not `vendors` (ADR-0012/0014). */
const MODULE = "documents" as const;

/** One document awaiting the verifier's decision — the current version of a slot on a Pending vendor. */
export type VerificationQueueItem = {
  readonly versionId: string;
  readonly slotId: string;
  readonly vendorId: string;
  readonly vendorName: string;
  readonly documentMasterId: string;
  readonly documentNo: string;
  readonly documentNameId: string;
  readonly documentNameEn: string;
  readonly documentMandatory: boolean;
  readonly versionNo: number;
  readonly refNo: string | null;
  readonly variant: string | null;
  readonly uploadedAt: Date;
};

/** A version after a verify/reject decision, as returned to the client. */
export type VerifiedVersionDTO = {
  readonly id: string;
  readonly slotId: string;
  readonly versionNo: number;
  readonly verifyStatus: string;
  readonly issuedOn: string | null;
  readonly expiresOn: string | null;
  readonly verifiedBy: string | null;
  readonly verifiedAt: Date | null;
  readonly rejectReason: string | null;
};

/** Why a decision couldn't be applied — mapped to an HTTP status by the route. */
export type DecideFailure = "not_found" | "not_current" | "vendor_not_pending" | "already_decided";

/**
 * What a decided document *was* — the vendor it belongs to and the type it is, in both languages.
 *
 * Carried out of the transaction (rather than re-read after it) because the notification has to name
 * the document in the **recipient's** locale, and the rows that know both spellings are already in
 * hand while the tx holds them.
 */
export type DecidedSubject = {
  readonly vendorId: string;
  readonly vendorName: string;
  readonly documentNameId: string | null;
  readonly documentNameEn: string | null;
};

export type DecideOutcome =
  | {
      readonly ok: true;
      readonly item: VerifiedVersionDTO;
      /** The vendor + document this decision was about — what a rejection notice is built from. */
      readonly subject: DecidedSubject;
      /**
       * Set (with the bounced vendor's id) when this decision returned the registration to Draft — a
       * **mandatory** doc was rejected (M5.3). The route uses it to fire the notify seam and tell the
       * console the vendor was bounced. Absent on a verify or an optional-doc reject.
       */
      readonly returnedToDraft?: { readonly vendorId: string };
    }
  | { readonly ok: false; readonly reason: DecideFailure };

/**
 * Notification seam — fired when a verifier **rejects** a document, so the vendor learns why (M5.3
 * seam, wired for real in M6.2). Kept out of the decide transaction so it can't fire on a rollback and
 * a delivery failure can't undo the rejection.
 *
 * **Widened in M6.2:** M5.3 fired this only when the rejection bounced the registration to Draft,
 * because a bounce was the only thing it had to report. M6.1 then wrote *two* templates — one saying
 * the registration went back to Draft, one saying it didn't — and the second is unreachable unless
 * every rejection fires. A vendor whose document was turned down is owed the reason whether or not the
 * document happened to be mandatory; the flag now selects the wording rather than gating the notice.
 */
export type VerificationNotifier = (event: {
  readonly ctx: RequestContext;
  readonly versionId: string;
  readonly reason: string;
  /** The vendor + document the rejection was about, both languages — read inside the decide tx. */
  readonly subject: DecidedSubject;
  /** Did this rejection bounce the registration to Draft (i.e. was the doc mandatory)? — M5.3. */
  readonly returnedToDraft: boolean;
}) => void | Promise<void>;

/**
 * The real seam (M6.2): tell the vendor's owner, through the M6.1 service. Default for the router, so
 * the wiring is on by construction and a test opts *out* by injecting a spy — rather than the M5.3
 * arrangement where the default was silence and production had to remember to opt in.
 */
const vendorRejectionNotifier: VerificationNotifier = ({ subject, reason, returnedToDraft }) =>
  notifyDocRejected(notificationReader(), {
    vendorId: subject.vendorId,
    vendorName: subject.vendorName,
    documentLabel: { nameId: subject.documentNameId, nameEn: subject.documentNameEn },
    reason,
    returnedToDraft,
    // The vendor's documents live on their registration view — where a re-upload also starts.
    url: `${env.portalUrl}/registration`,
  });

/**
 * The data-access seam behind the router — every DB (and, for presign, MinIO-key) touch, so the route is
 * testable with a fake. The store owns the decision guards (current version, vendor Pending, still
 * decidable) + the atomic verify/reject write + audit.
 */
export type DocumentVerificationStore = {
  /** Documents awaiting verification: current versions still `pending` on **Pending** vendors. */
  readonly queue: (filter: { vendorId?: string }) => Promise<VerificationQueueItem[]>;
  /** Verify a version, entering/confirming its issue/expiry dates. */
  readonly verify: (
    ctx: RequestContext,
    versionId: string,
    dates: VerifyDocumentInput,
    verifierUserId?: string,
  ) => Promise<DecideOutcome>;
  /** Reject a version with a reason. */
  readonly reject: (
    ctx: RequestContext,
    versionId: string,
    reason: string,
    verifierUserId?: string,
  ) => Promise<DecideOutcome>;
  /** The MinIO object key backing a version's file (for presigning a read), or `null` if unknown. */
  readonly versionObjectKey: (versionId: string) => Promise<string | null>;
};

/* ── The real Drizzle store ─────────────────────────────────────────────────────────────────────── */

const toVersionDTO = (row: typeof documentVersions.$inferSelect): VerifiedVersionDTO => ({
  id: row.id,
  slotId: row.slotId,
  versionNo: row.versionNo,
  verifyStatus: row.verifyStatus,
  issuedOn: row.issuedOn,
  expiresOn: row.expiresOn,
  verifiedBy: row.verifiedBy,
  verifiedAt: row.verifiedAt,
  rejectReason: row.rejectReason,
});

/** The transaction handle Drizzle hands the `transaction()` callback. */
type Tx = Parameters<Parameters<DB["transaction"]>[0]>[0];

export const drizzleDocumentVerificationStore = (
  dbHandle: DB = defaultDb,
): DocumentVerificationStore => {
  /** The version + its slot's owning vendor, loaded once per decision for the guards + the M5.3 bounce. */
  type DecidedRow = {
    versionId: string;
    verifyStatus: (typeof documentVersions.$inferSelect)["verifyStatus"];
    slotCurrentVersionId: string | null;
    vendorId: string;
    vendorName: string;
    vendorStatus: (typeof vendors.$inferSelect)["status"];
    documentMasterId: string;
    documentNameId: string | null;
    documentNameEn: string | null;
  };

  /**
   * Return the registration to Draft (M5.3, the M4.2 `return_to_draft` effect reached from the verify
   * path): resolve the vendor's open request `rejected` and bounce the vendor to `draft`, atomically in
   * the reject's transaction. The vendor is guarded Pending, so its single open request is the
   * registration — once back in Draft the vendor re-uploads (M3.3), the new version starting `pending`.
   * The doc's reject reason is already recorded on the version; the request/vendor changes are audited.
   */
  const returnRegistrationToDraft = async (
    tx: Tx,
    ctx: RequestContext,
    vendorId: string,
  ): Promise<void> => {
    const now = new Date();
    const [openRequest] = await tx
      .select({ id: approvalRequests.id })
      .from(approvalRequests)
      .where(
        and(eq(approvalRequests.subjectVendorId, vendorId), eq(approvalRequests.status, "pending")),
      )
      .limit(1);
    if (openRequest) {
      await tx
        .update(approvalRequests)
        .set({ status: "rejected", resolvedAt: now, updatedAt: now })
        .where(eq(approvalRequests.id, openRequest.id));
      await writeAudit(tx, ctx, {
        action: "approval_request.rejected",
        module: "approvals",
        subjectType: "approval_request",
        subjectId: openRequest.id,
      });
    }
    await tx
      .update(vendors)
      .set({ status: "draft", updatedAt: now })
      .where(eq(vendors.id, vendorId));
    await writeAudit(tx, ctx, {
      action: "vendor.returned_to_draft",
      module: "vendors",
      subjectType: "vendor",
      subjectId: vendorId,
    });
  };

  /**
   * Shared decide path: load the version with its slot + owning vendor, run the three guards (vendor
   * Pending, current version, still decidable), apply `patch`, audit `action`, then run `onDecided`
   * (reject's mandatory-doc bounce, if any) — all in one transaction so the write, audit, and bounce
   * commit together. `onDecided` may return the bounced vendor's id to surface on the outcome.
   */
  const decide = async (
    ctx: RequestContext,
    versionId: string,
    action: "document_version.verified" | "document_version.rejected",
    patch: Partial<typeof documentVersions.$inferInsert>,
    onDecided?: (tx: Tx, row: DecidedRow) => Promise<{ vendorId: string } | undefined>,
  ): Promise<DecideOutcome> =>
    dbHandle.transaction(async (tx) => {
      const [row] = await tx
        .select({
          versionId: documentVersions.id,
          verifyStatus: documentVersions.verifyStatus,
          slotCurrentVersionId: documentSlots.currentVersionId,
          vendorId: documentSlots.vendorId,
          // The vendor's name + the document's bilingual label ride along so a rejection can be
          // *described* to the vendor (M6.2) without a second round-trip after the tx.
          vendorName: vendors.name,
          vendorStatus: vendors.status,
          documentMasterId: documentSlots.documentMasterId,
          documentNameId: documentMaster.nameId,
          documentNameEn: documentMaster.nameEn,
        })
        .from(documentVersions)
        .innerJoin(documentSlots, eq(documentVersions.slotId, documentSlots.id))
        .innerJoin(vendors, eq(documentSlots.vendorId, vendors.id))
        .innerJoin(documentMaster, eq(documentMaster.id, documentSlots.documentMasterId))
        .where(eq(documentVersions.id, versionId))
        .limit(1);
      if (!row) return { ok: false, reason: "not_found" as const };
      if (row.vendorStatus !== "pending")
        return { ok: false, reason: "vendor_not_pending" as const };
      if (row.slotCurrentVersionId !== row.versionId)
        return { ok: false, reason: "not_current" as const };
      if (!isVersionDecidable(row.verifyStatus))
        return { ok: false, reason: "already_decided" as const };

      const [updated] = await tx
        .update(documentVersions)
        .set({ ...patch, updatedAt: new Date() })
        .where(eq(documentVersions.id, versionId))
        .returning();
      if (!updated) throw new Error("document_version vanished mid-transaction");
      await writeAudit(tx, ctx, {
        action,
        module: MODULE,
        subjectType: "document_version",
        subjectId: versionId,
      });
      const returnedToDraft = onDecided ? await onDecided(tx, row) : undefined;
      return {
        ok: true as const,
        item: toVersionDTO(updated),
        subject: {
          vendorId: row.vendorId,
          vendorName: row.vendorName,
          documentNameId: row.documentNameId,
          documentNameEn: row.documentNameEn,
        },
        returnedToDraft,
      };
    });

  return {
    queue: async (filter) => {
      const conds = [
        eq(vendors.status, "pending"),
        eq(documentVersions.id, documentSlots.currentVersionId),
        eq(documentVersions.verifyStatus, "pending"),
      ];
      if (filter.vendorId) conds.push(eq(documentSlots.vendorId, filter.vendorId));
      const rows = await dbHandle
        .select({
          versionId: documentVersions.id,
          slotId: documentSlots.id,
          vendorId: vendors.id,
          vendorName: vendors.name,
          documentMasterId: documentMaster.id,
          documentNo: documentMaster.no,
          documentNameId: documentMaster.nameId,
          documentNameEn: documentMaster.nameEn,
          documentMandatory: documentMaster.mandatory,
          versionNo: documentVersions.versionNo,
          refNo: documentVersions.refNo,
          variant: documentVersions.variant,
          uploadedAt: documentVersions.createdAt,
        })
        .from(documentVersions)
        .innerJoin(documentSlots, eq(documentVersions.slotId, documentSlots.id))
        .innerJoin(vendors, eq(documentSlots.vendorId, vendors.id))
        .innerJoin(documentMaster, eq(documentSlots.documentMasterId, documentMaster.id))
        .where(and(...conds))
        .orderBy(desc(documentVersions.createdAt));
      return rows;
    },

    verify: (ctx, versionId, dates, verifierUserId) =>
      decide(ctx, versionId, "document_version.verified", {
        verifyStatus: "verified",
        issuedOn: dates.issuedOn ?? null,
        expiresOn: dates.expiresOn ?? null,
        rejectReason: null,
        verifiedBy: verifierUserId ?? null,
        verifiedAt: new Date(),
      }),

    reject: (ctx, versionId, reason, verifierUserId) =>
      decide(
        ctx,
        versionId,
        "document_version.rejected",
        {
          verifyStatus: "rejected",
          rejectReason: reason,
          verifiedBy: verifierUserId ?? null,
          verifiedAt: new Date(),
        },
        // M5.3: only a **mandatory** doc (in the vendor's required set, origin ∪ single-category — the
        // exact set the M5.2 gate waits on) bounces the registration to Draft; an optional doc doesn't.
        async (tx, row) => {
          const requiredIds = await requiredDocMasterIdsForVendor(tx, row.vendorId);
          if (!requiredIds.includes(row.documentMasterId)) return undefined;
          await returnRegistrationToDraft(tx, ctx, row.vendorId);
          return { vendorId: row.vendorId };
        },
      ),

    versionObjectKey: async (versionId) => {
      const [row] = await dbHandle
        .select({ objectKey: files.objectKey })
        .from(documentVersions)
        .innerJoin(files, eq(documentVersions.fileId, files.id))
        .where(eq(documentVersions.id, versionId))
        .limit(1);
      return row?.objectKey ?? null;
    },
  };
};

/* ── Route ──────────────────────────────────────────────────────────────────────────────────────── */

/** Map a decide failure to its HTTP response. `not_found` → 404; the rest are 409 conflicts. */
const decideError = (reason: DecideFailure) => {
  switch (reason) {
    case "not_found":
      return notFoundError();
    case "vendor_not_pending":
      return conflictError({ messageKey: "error.document.vendorNotPending" });
    case "not_current":
      return conflictError({ messageKey: "error.document.notCurrentVersion" });
    case "already_decided":
      return conflictError({ messageKey: "error.document.alreadyDecided" });
  }
};

/**
 * Build the `/console/document-verification` router. The store + storage are injectable so the surface is
 * testable without Postgres or MinIO; the defaults are the real Drizzle store + Bun S3 file store.
 */
export const documentVerificationRoutes = (
  store: DocumentVerificationStore = drizzleDocumentVerificationStore(),
  storage: AttachmentStorage = attachmentStorage(),
  notify: VerificationNotifier = vendorRejectionNotifier,
): Hono<AppEnv> => {
  const app = new Hono<AppEnv>();

  // The verifier's queue: current, still-pending versions on vendors under review. `?vendorId=` narrows.
  app.get("/", requirePermission(MODULE, "view"), async (c) => {
    const vendorId = c.req.query("vendorId");
    return c.json({ items: await store.queue(vendorId ? { vendorId } : {}) });
  });

  // Presign a read of one version's file so the verifier can view the document before deciding.
  app.get("/versions/:versionId/url", requirePermission(MODULE, "view"), async (c) => {
    const key = await store.versionObjectKey(c.req.param("versionId"));
    if (!key) return sendError(c, notFoundError());
    return c.json({ url: await storage.presignGet(key) });
  });

  // Verify a version, entering/confirming its issue/expiry dates.
  app.post("/versions/:versionId/verify", requirePermission(MODULE, "approve"), async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      body = {};
    }
    const parsed = parseWith(verifyDocumentInput, body ?? {});
    if (!parsed.ok) return sendError(c, parsed.error);
    const outcome = await store.verify(
      c.var.ctx,
      c.req.param("versionId"),
      parsed.value,
      c.var.ctx.actor?.userId,
    );
    return outcome.ok ? c.json({ item: outcome.item }) : sendError(c, decideError(outcome.reason));
  });

  // Reject a version with a required reason.
  app.post("/versions/:versionId/reject", requirePermission(MODULE, "approve"), async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      body = {};
    }
    const parsed = parseWith(rejectDocumentInput, body ?? {});
    if (!parsed.ok) {
      return sendError(c, validationError({ messageKey: "error.document.rejectReasonRequired" }));
    }
    const reason = (parsed.value as RejectDocumentInput).reason;
    const versionId = c.req.param("versionId");
    const outcome = await store.reject(c.var.ctx, versionId, reason, c.var.ctx.actor?.userId);
    if (!outcome.ok) return sendError(c, decideError(outcome.reason));
    // Tell the vendor their document was turned down, and why — after the decide tx committed, so a
    // mail failure can't undo the rejection. Fires on **every** reject (M6.2): `returnedToDraft`
    // chooses between the "your registration is back in Draft" copy and the optional-doc copy that
    // must not imply a move that didn't happen — it no longer decides *whether* the vendor is told.
    await notify({
      ctx: c.var.ctx,
      versionId,
      reason,
      subject: outcome.subject,
      returnedToDraft: !!outcome.returnedToDraft,
    });
    return c.json({ item: outcome.item, returnedToDraft: !!outcome.returnedToDraft });
  });

  return app;
};
