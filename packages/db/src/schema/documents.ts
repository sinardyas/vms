import {
  date,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { timestamps } from "./_shared";
import { verifyStatusEnum } from "./enums";
import { users } from "./auth";
import { documentMaster } from "./master-data";
import { vendors } from "./vendors";
import { files } from "./files";

// Gated compliance documents only (ADR-0013). Versioned with a current pointer (ADR-0011).
// A slot = one required doc type for one vendor; versions are immutable uploads.

export const documentSlots = pgTable(
  "document_slots",
  {
    id: uuid().primaryKey().defaultRandom(),
    vendorId: uuid()
      .notNull()
      .references(() => vendors.id, { onDelete: "cascade" }),
    documentMasterId: uuid()
      .notNull()
      .references(() => documentMaster.id),
    // points at the current document_versions.id. Intentionally NOT a hard FK to avoid a
    // circular slot⇄version constraint; enforced in app + a deferred constraint later.
    currentVersionId: uuid(),
    ...timestamps,
  },
  (t) => [uniqueIndex("document_slots_uq").on(t.vendorId, t.documentMasterId)],
);

export const documentVersions = pgTable(
  "document_versions",
  {
    id: uuid().primaryKey().defaultRandom(),
    slotId: uuid()
      .notNull()
      .references(() => documentSlots.id, { onDelete: "cascade" }),
    versionNo: integer().notNull().default(1),
    fileId: uuid()
      .notNull()
      .references(() => files.id),
    // Certificate / registration number typed beside the upload (drift-audit #4 P0) —
    // generalises No. NPWP / No. SIUP / No. NIB / deed no. `vendors.taxId` stays the dedup key.
    refNo: varchar({ length: 120 }),
    // Document sub-variant (drift-audit #4 P1) — e.g. Jenis Akta: Pendirian / Perubahan Nama / Amendment.
    variant: varchar({ length: 60 }),
    // Real certificate dates entered by the vendor, confirmed by the verifier (ADR-0010).
    issuedOn: date(),
    expiresOn: date(), // = validUntil
    verifyStatus: verifyStatusEnum().notNull().default("pending"),
    verifiedBy: uuid().references(() => users.id),
    verifiedAt: timestamp({ withTimezone: true }),
    rejectReason: text(),
    uploadedBy: uuid().references(() => users.id),
    ...timestamps,
  },
  (t) => [uniqueIndex("document_versions_slot_version_uq").on(t.slotId, t.versionNo)],
);
