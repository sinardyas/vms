import { sql } from "drizzle-orm";
import { boolean, integer, pgTable, text, uniqueIndex, uuid, varchar } from "drizzle-orm/pg-core";
import { timestamps } from "./_shared";
import {
  companyScaleEnum,
  npwpTypeEnum,
  originEnum,
  paymentTermEnum,
  taxStatusEnum,
  vendorSourceEnum,
  vendorStatusEnum,
} from "./enums";
import { users } from "./auth";
import { banks, businessEntities, countries, currencies, vendorCategories } from "./master-data";
import { files } from "./files";

// The Vendor aggregate (ADR-0004, 0013). Origin drives the required field/document shape.
export const vendors = pgTable(
  "vendors",
  {
    id: uuid().primaryKey().defaultRandom(),
    origin: originEnum().notNull(),
    status: vendorStatusEnum().notNull().default("draft"),
    source: vendorSourceEnum().notNull(),
    shortCode: varchar({ length: 8 }), // generated on activation (ADR-0015)

    // identity
    name: varchar({ length: 240 }).notNull(),
    businessEntityId: uuid().references(() => businessEntities.id),
    categoryId: uuid().references(() => vendorCategories.id), // single category (ADR-0013)
    taxId: varchar({ length: 40 }), // NPWP (local) | VAT/BRN (foreign); null in Draft
    // taxation status (drift-audit #4 P0): PKP status × taxpayer type; drives PPN + SPPKP.
    // Nullable in Draft, required at submit for local origin (M3.4).
    taxStatus: taxStatusEnum(),
    npwpType: npwpTypeEnum(), // personal / head-office / branch NPWP (drift-audit #4)
    companyScale: companyScaleEnum(), // Skala Perusahaan per SIUP (drift-audit #4 P1)
    // "Vendor Procurement" portal field — preserved as a free-text note; drives nothing in
    // Phase-0 (E-Proc integration is Phase-2). Kept so staff don't lose what the vendor typed.
    procurementNote: varchar({ length: 200 }),

    // profile
    address: text(),
    city: varchar({ length: 120 }),
    postal: varchar({ length: 20 }),
    countryId: uuid().references(() => countries.id),
    phone: varchar({ length: 40 }),
    fax: varchar({ length: 40 }),
    yearFounded: integer(),
    website: varchar({ length: 200 }),
    email: varchar({ length: 320 }),

    // people
    commissioner: varchar({ length: 200 }),
    director: varchar({ length: 200 }),
    picName: varchar({ length: 200 }),
    picRole: varchar({ length: 160 }),
    picPhone: varchar({ length: 40 }), // WhatsApp
    picEmail: varchar({ length: 320 }),
    soechiReference: varchar({ length: 200 }),

    // payment terms + signed-terms attachment (validated, not gated — ADR-0013)
    paymentTerm: paymentTermEnum(),
    signedTermsFileId: uuid().references(() => files.id),

    // one pending change at a time on an Active vendor (ADR-0010)
    changePending: boolean().notNull().default(false),

    ...timestamps,
  },
  (t) => [
    // Tax-ID unique among non-Draft records; Drafts may collide, caught at submit (ADR-0010).
    uniqueIndex("vendors_tax_id_non_draft_uq")
      .on(t.taxId)
      .where(sql`status <> 'draft' and tax_id is not null`),
  ],
);

// User ↔ Vendor membership. Single owner in Phase 0; modelled for later multi-user (ADR-0009).
export const vendorSubUsers = pgTable(
  "vendor_sub_users",
  {
    id: uuid().primaryKey().defaultRandom(),
    vendorId: uuid()
      .notNull()
      .references(() => vendors.id, { onDelete: "cascade" }),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    isOwner: boolean().notNull().default(false),
    ...timestamps,
  },
  (t) => [uniqueIndex("vendor_sub_users_uq").on(t.vendorId, t.userId)],
);

// Vendor bank accounts. Attachments (proof/KTP/surat) are validated, NOT gated (ADR-0013).
export const vendorBanks = pgTable(
  "vendor_banks",
  {
    id: uuid().primaryKey().defaultRandom(),
    vendorId: uuid()
      .notNull()
      .references(() => vendors.id, { onDelete: "cascade" }),
    bankId: uuid().references(() => banks.id), // resolved from master where possible…
    bankName: varchar({ length: 200 }).notNull(), // …else the entered name
    accountNo: varchar({ length: 60 }).notNull(),
    holderName: varchar({ length: 240 }).notNull(),
    branch: varchar({ length: 160 }),
    description: varchar({ length: 200 }), // bank "Deskripsi/Description" field (drift-audit #4 P1)
    swift: varchar({ length: 16 }),
    iban: varchar({ length: 40 }),
    bankCountryId: uuid().references(() => countries.id),
    isPrimary: boolean().notNull().default(false), // exactly one Bank Utama per vendor
    holderSameAsCompany: boolean().notNull().default(true),
    // remark required when bank country ≠ vendor country (ADR-0005 invariants)
    differsFromCompanyRemark: text(),
    // required when holderSameAsCompany = false (ADR-0007 context)
    proofFileId: uuid().references(() => files.id), // buku tabungan / account proof
    ktpFileId: uuid().references(() => files.id),
    suratPernyataanFileId: uuid().references(() => files.id),
    ...timestamps,
  },
  (t) => [
    // exactly one primary bank per vendor (Bank Utama)
    uniqueIndex("vendor_banks_one_primary_uq").on(t.vendorId).where(sql`is_primary`),
  ],
);

export const vendorBankCurrencies = pgTable(
  "vendor_bank_currencies",
  {
    id: uuid().primaryKey().defaultRandom(),
    vendorBankId: uuid()
      .notNull()
      .references(() => vendorBanks.id, { onDelete: "cascade" }),
    currencyId: uuid()
      .notNull()
      .references(() => currencies.id),
  },
  (t) => [uniqueIndex("vendor_bank_currencies_uq").on(t.vendorBankId, t.currencyId)],
);
