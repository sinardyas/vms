/**
 * Vendor compliance-document capture (M3.3, #44, ADR-0011/0013).
 *
 * The vendor-scoped sub-resource for capturing **gated** compliance documents during registration:
 * `document_slots` (one per required doc type per vendor) each holding immutable, versioned
 * `document_versions`, with the bytes in MinIO behind the M3.2 storage seam. Mounted at
 * `/vendors/:vendorId/documents`; the vendor record itself and its required-doc *set* are owned by the
 * portal/office screens (M3.5/M3.6) and the M3.4 submit gate — here we own only the upload + versioning.
 *
 * Shape (ADR-0011): a **slot** is `(vendor × document type)`; uploading appends a new **version** and
 * moves the slot's `currentVersionId` pointer. Re-uploading a rejected document (M5.3) is just another
 * version on the same slot — the pointer moves, history is kept — so this capture path is already the
 * re-upload path. The first upload for a `(vendor, doc type)` pair creates the slot; later ones append.
 *
 * Captured here, entered at verify (M5): a version records only which doc type, the file, and the
 * reference/variant numbers typed beside it. The certificate **issue/expiry dates and verify status are
 * the verifier's at M5** (ADR-0010), so this route never accepts them — they stay at their defaults.
 *
 * Files are **validated, not gated** (ADR-0013): the shared `validateAttachment` (M3.2) rejects a wrong
 * type / oversize file before storing; reads are short-lived **signed URLs** the browser fetches straight
 * from MinIO. Compliance docs land under their own `document-versions/` object-key namespace.
 */

import {
  type DB,
  db as defaultDb,
  documentMaster,
  documentSlots,
  documentVersions,
  files,
  vendors,
} from "@vms/db";
import {
  type RequestContext,
  type VendorDocumentVersionInput,
  type VendorStatus,
  conflictError,
  invariantError,
  isCaptureEditable,
  notFoundError,
  parseWith,
  validationError,
  vendorDocumentVersionInput,
} from "@vms/domain";
import { and, desc, eq } from "drizzle-orm";
import { Hono } from "hono";
import { writeAudit } from "./audit";
import type { AppEnv } from "./context";
import { sendError } from "./http-error";
import { requirePermission } from "./rbac";
import { type AttachmentStorage, attachmentStorage } from "./storage";

/** Document capture is part of vendor registration — it gates on the `vendors` RBAC module (ADR-0012). */
const MODULE = "vendors" as const;

/** Object-key namespace for compliance-doc versions (distinct from `vendor-banks`). */
const DOCUMENT_KEY_PREFIX = "document-versions";

/** One uploaded version of a document, as returned to the client. */
export type DocumentVersionDTO = {
  readonly id: string;
  readonly slotId: string;
  readonly versionNo: number;
  readonly fileId: string;
  readonly refNo: string | null;
  readonly variant: string | null;
  // Entered at verification (M5), null at capture — surfaced so the portal/console can show them later.
  readonly issuedOn: string | null;
  readonly expiresOn: string | null;
  readonly verifyStatus: string;
  readonly verifiedBy: string | null;
  readonly verifiedAt: Date | null;
  readonly rejectReason: string | null;
  readonly uploadedBy: string | null;
  readonly createdAt: Date;
};

/** One document slot with its current version and full version history (newest first). */
export type DocumentSlotDTO = {
  readonly id: string;
  readonly vendorId: string;
  readonly documentMasterId: string;
  readonly currentVersionId: string | null;
  readonly currentVersion: DocumentVersionDTO | null;
  readonly versions: DocumentVersionDTO[];
};

/**
 * The data-access seam behind the router — every DB touch, so the route is testable with a fake. The
 * store owns the slot upsert + version bump + atomic audit; the route owns validation and the storage
 * (upload / presign) it drives before handing the resulting file id to {@link VendorDocumentStore.addVersion}.
 */
export type VendorDocumentStore = {
  /**
   * The owning vendor's lifecycle status, or `null` if it doesn't exist. Reads need only existence; the
   * capture mutations also gate on it — document capture is frozen once the vendor leaves Draft (M4.4,
   * ADR-0014).
   */
  readonly getVendorStatus: (vendorId: string) => Promise<VendorStatus | null>;
  /** Is `documentMasterId` a real Document Master row? (clean 422 instead of an FK 500 on a bad id). */
  readonly documentMasterExists: (documentMasterId: string) => Promise<boolean>;
  readonly list: (vendorId: string) => Promise<DocumentSlotDTO[]>;
  /**
   * Upsert the `(vendor, doc type)` slot, append a new version referencing an already-stored file, bump
   * `versionNo`, and move the slot's `currentVersionId`. The M5.3 re-upload shape.
   */
  readonly addVersion: (
    ctx: RequestContext,
    vendorId: string,
    input: VendorDocumentVersionInput,
    fileId: string,
    uploadedBy?: string,
  ) => Promise<DocumentSlotDTO>;
  /** The object key backing a version's file (for presigning a read), or `null` if unknown. */
  readonly versionObjectKey: (vendorId: string, versionId: string) => Promise<string | null>;
  /** Delete a slot + its versions (draft-time correction of a wrongly-added doc), or `null` if unknown. */
  readonly removeSlot: (
    ctx: RequestContext,
    vendorId: string,
    slotId: string,
  ) => Promise<DocumentSlotDTO | null>;
};

/* ── The real Drizzle store ─────────────────────────────────────────────────────────────────────── */

const toVersionDTO = (row: typeof documentVersions.$inferSelect): DocumentVersionDTO => ({
  id: row.id,
  slotId: row.slotId,
  versionNo: row.versionNo,
  fileId: row.fileId,
  refNo: row.refNo,
  variant: row.variant,
  issuedOn: row.issuedOn,
  expiresOn: row.expiresOn,
  verifyStatus: row.verifyStatus,
  verifiedBy: row.verifiedBy,
  verifiedAt: row.verifiedAt,
  rejectReason: row.rejectReason,
  uploadedBy: row.uploadedBy,
  createdAt: row.createdAt,
});

const toSlotDTO = (
  slot: typeof documentSlots.$inferSelect,
  versionRows: (typeof documentVersions.$inferSelect)[],
): DocumentSlotDTO => {
  const versions = versionRows.map(toVersionDTO);
  return {
    id: slot.id,
    vendorId: slot.vendorId,
    documentMasterId: slot.documentMasterId,
    currentVersionId: slot.currentVersionId,
    currentVersion: versions.find((v) => v.id === slot.currentVersionId) ?? null,
    versions,
  };
};

/** The transaction handle Drizzle hands the `transaction()` callback — accepted by the shared loader. */
type Tx = Parameters<Parameters<DB["transaction"]>[0]>[0];

export const drizzleVendorDocumentStore = (dbHandle: DB = defaultDb): VendorDocumentStore => {
  /** Load a slot with its versions (newest first) on the given transaction, or `null`. */
  const loadSlot = async (handle: Tx, slotId: string): Promise<DocumentSlotDTO | null> => {
    const [slot] = await handle
      .select()
      .from(documentSlots)
      .where(eq(documentSlots.id, slotId))
      .limit(1);
    if (!slot) return null;
    const versionRows = await handle
      .select()
      .from(documentVersions)
      .where(eq(documentVersions.slotId, slotId))
      .orderBy(desc(documentVersions.versionNo));
    return toSlotDTO(slot, versionRows);
  };

  return {
    getVendorStatus: async (vendorId) => {
      const [row] = await dbHandle
        .select({ status: vendors.status })
        .from(vendors)
        .where(eq(vendors.id, vendorId))
        .limit(1);
      return row?.status ?? null;
    },

    documentMasterExists: async (documentMasterId) => {
      const [row] = await dbHandle
        .select({ id: documentMaster.id })
        .from(documentMaster)
        .where(eq(documentMaster.id, documentMasterId))
        .limit(1);
      return !!row;
    },

    list: async (vendorId) => {
      const slots = await dbHandle
        .select()
        .from(documentSlots)
        .where(eq(documentSlots.vendorId, vendorId))
        .orderBy(desc(documentSlots.createdAt));
      const out: DocumentSlotDTO[] = [];
      for (const slot of slots) {
        const versionRows = await dbHandle
          .select()
          .from(documentVersions)
          .where(eq(documentVersions.slotId, slot.id))
          .orderBy(desc(documentVersions.versionNo));
        out.push(toSlotDTO(slot, versionRows));
      }
      return out;
    },

    addVersion: (ctx, vendorId, input, fileId, uploadedBy) =>
      dbHandle.transaction(async (tx) => {
        // Upsert the (vendor × doc type) slot — the unique index makes this pair the slot's identity.
        const [existing] = await tx
          .select()
          .from(documentSlots)
          .where(
            and(
              eq(documentSlots.vendorId, vendorId),
              eq(documentSlots.documentMasterId, input.documentMasterId),
            ),
          )
          .limit(1);
        let slot = existing;
        if (!slot) {
          const [created] = await tx
            .insert(documentSlots)
            .values({ vendorId, documentMasterId: input.documentMasterId })
            .returning();
          if (!created) throw new Error("document_slot insert returned no row");
          slot = created;
        }
        // Next version number for this slot (immutable, monotonic — the M5.3 re-upload chain).
        const [last] = await tx
          .select({ versionNo: documentVersions.versionNo })
          .from(documentVersions)
          .where(eq(documentVersions.slotId, slot.id))
          .orderBy(desc(documentVersions.versionNo))
          .limit(1);
        const versionNo = (last?.versionNo ?? 0) + 1;
        const [version] = await tx
          .insert(documentVersions)
          .values({
            slotId: slot.id,
            versionNo,
            fileId,
            refNo: input.refNo ?? null,
            variant: input.variant ?? null,
            uploadedBy: uploadedBy ?? null,
          })
          .returning();
        if (!version) throw new Error("document_version insert returned no row");
        // Move the slot's current pointer to the fresh version.
        await tx
          .update(documentSlots)
          .set({ currentVersionId: version.id, updatedAt: new Date() })
          .where(eq(documentSlots.id, slot.id));
        await writeAudit(tx, ctx, {
          action: "document_version.uploaded",
          module: MODULE,
          subjectType: "document_version",
          subjectId: version.id,
        });
        const reloaded = await loadSlot(tx, slot.id);
        if (!reloaded) throw new Error("document_slot vanished mid-transaction");
        return reloaded;
      }),

    versionObjectKey: async (vendorId, versionId) => {
      const [row] = await dbHandle
        .select({ objectKey: files.objectKey })
        .from(documentVersions)
        .innerJoin(documentSlots, eq(documentVersions.slotId, documentSlots.id))
        .innerJoin(files, eq(documentVersions.fileId, files.id))
        .where(and(eq(documentVersions.id, versionId), eq(documentSlots.vendorId, vendorId)))
        .limit(1);
      return row?.objectKey ?? null;
    },

    removeSlot: (ctx, vendorId, slotId) =>
      dbHandle.transaction(async (tx) => {
        const loaded = await loadSlot(tx, slotId);
        if (!loaded || loaded.vendorId !== vendorId) return null;
        // Versions cascade on the slot's FK (onDelete: "cascade"); file objects are left in MinIO.
        await tx.delete(documentSlots).where(eq(documentSlots.id, slotId));
        await writeAudit(tx, ctx, {
          action: "document_slot.deleted",
          module: MODULE,
          subjectType: "document_slot",
          subjectId: slotId,
        });
        return loaded;
      }),
  };
};

/* ── Route ──────────────────────────────────────────────────────────────────────────────────────── */

/**
 * Read the capture fields off a multipart body and validate them against the shared schema. Text fields
 * come through as strings; empty strings are treated as absent (so an optional field left blank doesn't
 * fail its `min(1)`). The `file` field is handled separately by the caller.
 */
const parseVersionFields = (body: Record<string, unknown>) => {
  const pick = (k: string) => {
    const v = body[k];
    return typeof v === "string" && v.trim() !== "" ? v : undefined;
  };
  return parseWith(vendorDocumentVersionInput, {
    documentMasterId: pick("documentMasterId"),
    refNo: pick("refNo"),
    variant: pick("variant"),
  });
};

/**
 * Build the `/vendors/:vendorId/documents` router. Stores are injectable so the whole surface is testable
 * without Postgres or MinIO; the defaults are the real Drizzle store + Bun S3 file store.
 */
export const vendorDocumentsRoutes = (
  store: VendorDocumentStore = drizzleVendorDocumentStore(),
  storage: AttachmentStorage = attachmentStorage(),
): Hono<AppEnv> => {
  const app = new Hono<AppEnv>();

  // Upload a document version (validated, not gated): multipart `file` + `documentMasterId` (+ optional
  // `refNo`/`variant`). Stores the bytes, then appends a version to the (vendor × doc type) slot.
  app.post("/:vendorId/documents/versions", requirePermission(MODULE, "add"), async (c) => {
    const vendorId = c.req.param("vendorId");
    const status = await store.getVendorStatus(vendorId);
    if (status === null) return sendError(c, notFoundError());
    // Capture is frozen once the vendor leaves Draft (M4.4, ADR-0014) — change via recall/reject.
    if (!isCaptureEditable(status)) {
      return sendError(c, conflictError({ messageKey: "error.vendor.notDraft" }));
    }

    let body: Record<string, unknown>;
    try {
      body = await c.req.parseBody();
    } catch {
      return sendError(c, validationError());
    }
    const parsed = parseVersionFields(body);
    if (!parsed.ok) return sendError(c, parsed.error);

    const file = body.file;
    if (!(file instanceof File)) {
      return sendError(c, validationError({ messageKey: "error.file.empty" }));
    }
    if (!(await store.documentMasterExists(parsed.value.documentMasterId))) {
      return sendError(c, invariantError({ messageKey: "error.document.masterUnknown" }));
    }

    const uploadedBy = c.var.ctx.actor?.userId;
    const stored = await storage.upload({
      bytes: new Uint8Array(await file.arrayBuffer()),
      mime: file.type,
      sizeBytes: file.size,
      originalName: file.name,
      uploadedBy,
      keyPrefix: DOCUMENT_KEY_PREFIX,
    });
    if (!stored.ok) return sendError(c, stored.error);

    const slot = await store.addVersion(
      c.var.ctx,
      vendorId,
      parsed.value,
      stored.value.id,
      uploadedBy,
    );
    return c.json({ item: slot }, 201);
  });

  // Presign a read of one version's file.
  app.get(
    "/:vendorId/documents/versions/:versionId/url",
    requirePermission(MODULE, "view"),
    async (c) => {
      const key = await store.versionObjectKey(c.req.param("vendorId"), c.req.param("versionId"));
      if (!key) return sendError(c, notFoundError());
      return c.json({ url: await storage.presignGet(key) });
    },
  );

  // List a vendor's captured document slots (each with its current version + history).
  app.get("/:vendorId/documents", requirePermission(MODULE, "view"), async (c) => {
    const vendorId = c.req.param("vendorId");
    if ((await store.getVendorStatus(vendorId)) === null) return sendError(c, notFoundError());
    return c.json({ items: await store.list(vendorId) });
  });

  // Remove a slot + its versions (draft-time correction of a wrongly-added document). Frozen once the
  // vendor leaves Draft (M4.4, ADR-0014) — the submitted document set is immutable under review.
  app.delete(
    "/:vendorId/documents/slots/:slotId",
    requirePermission(MODULE, "delete"),
    async (c) => {
      const vendorId = c.req.param("vendorId");
      const status = await store.getVendorStatus(vendorId);
      if (status === null) return sendError(c, notFoundError());
      if (!isCaptureEditable(status)) {
        return sendError(c, conflictError({ messageKey: "error.vendor.notDraft" }));
      }
      const slot = await store.removeSlot(c.var.ctx, vendorId, c.req.param("slotId"));
      return slot === null ? sendError(c, notFoundError()) : c.json({ item: slot });
    },
  );

  return app;
};
