import { boolean, integer, pgTable, uniqueIndex, uuid, varchar } from "drizzle-orm/pg-core";
import { activeFlag, timestamps } from "./_shared";
import { docAppliesToEnum, localityEnum } from "./enums";
import { roles } from "./rbac";

// All 16 master lists (ADR-0002). Bilingual labels via name_id/name_en where the value is a term;
// proper names (banks/countries/currencies/vessels/ports) keep a single `name` (ADR-0011).

/* ── Registration lists (feed the portal registration form) ───────────────── */

export const businessEntities = pgTable("business_entities", {
  id: uuid().primaryKey().defaultRandom(),
  nameId: varchar({ length: 120 }).notNull(),
  nameEn: varchar({ length: 120 }).notNull(),
  category: localityEnum().notNull(), // vendor legal form is Local or Foreign (ADR-0006 guard)
  ...activeFlag,
  ...timestamps,
});

export const vendorCategories = pgTable("vendor_categories", {
  id: uuid().primaryKey().defaultRandom(),
  nameId: varchar({ length: 160 }).notNull(),
  nameEn: varchar({ length: 160 }).notNull(),
  ...activeFlag,
  ...timestamps,
});

export const countries = pgTable(
  "countries",
  {
    id: uuid().primaryKey().defaultRandom(),
    name: varchar({ length: 120 }).notNull(),
    iso3: varchar({ length: 3 }).notNull(),
    ...activeFlag,
    ...timestamps,
  },
  (t) => [uniqueIndex("countries_iso3_uq").on(t.iso3)],
);

export const currencies = pgTable(
  "currencies",
  {
    id: uuid().primaryKey().defaultRandom(),
    code: varchar({ length: 3 }).notNull(),
    name: varchar({ length: 120 }).notNull(),
    country: varchar({ length: 120 }),
    showInBankSelector: boolean().notNull().default(true), // the 'multi' flag from the console
    ...activeFlag,
    ...timestamps,
  },
  (t) => [uniqueIndex("currencies_code_uq").on(t.code)],
);

export const banks = pgTable(
  "banks",
  {
    id: uuid().primaryKey().defaultRandom(),
    name: varchar({ length: 160 }).notNull(),
    code: varchar({ length: 16 }).notNull(),
    location: localityEnum().notNull(), // Local banks → local vendors; Foreign → foreign (console note)
    countryId: uuid().references(() => countries.id),
    ...activeFlag,
    ...timestamps,
  },
  (t) => [uniqueIndex("banks_code_uq").on(t.code)],
);

/* ── Document Master + category requirements (drive the activation gate) ───── */

export const documentMaster = pgTable(
  "document_master",
  {
    id: uuid().primaryKey().defaultRandom(),
    no: varchar({ length: 16 }).notNull(), // e.g. 'DOC-001'
    nameId: varchar({ length: 200 }).notNull(),
    nameEn: varchar({ length: 200 }).notNull(),
    type: varchar({ length: 40 }).notNull(), // Legal | Tax | HSE | Finance | Quality | Category | Bank …
    appliesTo: docAppliesToEnum().notNull(), // origin applicability
    validityDays: integer().notNull().default(0), // 0 = no validity required (a hint, not truth — ADR-0010)
    mandatory: boolean().notNull().default(false), // origin-level mandatory
    reminder: varchar({ length: 20 }).notNull().default("Off"), // Off | 2 weeks | 1 month (config only, ADR-0007)
    enabled: boolean().notNull().default(true), // disabled docs are not requested from vendors
    ...timestamps,
  },
  (t) => [uniqueIndex("document_master_no_uq").on(t.no)],
);

// M:N: a doc type may be required by many categories; a category may require many docs (ADR-0013).
export const categoryDocumentRequirements = pgTable(
  "category_document_requirements",
  {
    id: uuid().primaryKey().defaultRandom(),
    categoryId: uuid()
      .notNull()
      .references(() => vendorCategories.id, { onDelete: "cascade" }),
    documentMasterId: uuid()
      .notNull()
      .references(() => documentMaster.id, { onDelete: "cascade" }),
    mandatory: boolean().notNull().default(true),
    ...activeFlag,
    ...timestamps,
  },
  (t) => [uniqueIndex("cat_doc_req_uq").on(t.categoryId, t.documentMasterId)],
);

/* ── Approval Routes (drive the workflow engine) ──────────────────────────── */

export const approvalRoutes = pgTable(
  "approval_routes",
  {
    id: uuid().primaryKey().defaultRandom(),
    trigger: varchar({ length: 40 }).notNull(), // matches approval_trigger enum values (one route per trigger)
    nameId: varchar({ length: 160 }).notNull(),
    nameEn: varchar({ length: 160 }).notNull(),
    ...activeFlag,
    ...timestamps,
  },
  (t) => [uniqueIndex("approval_routes_trigger_uq").on(t.trigger)],
);

// Ordered approver ROLES for a route (ADR-0005). Actionable by role ∧ approve-perm − SoD.
export const approvalRouteSteps = pgTable(
  "approval_route_steps",
  {
    id: uuid().primaryKey().defaultRandom(),
    routeId: uuid()
      .notNull()
      .references(() => approvalRoutes.id, { onDelete: "cascade" }),
    stepNo: integer().notNull(),
    roleId: uuid()
      .notNull()
      .references(() => roles.id),
    ...timestamps,
  },
  (t) => [uniqueIndex("approval_route_steps_uq").on(t.routeId, t.stepNo)],
);

/* ── Operational lists (Phase 0: CRUD-managed, behaviorally inert — ADR-0002) ─ */

export const departments = pgTable(
  "departments",
  {
    id: uuid().primaryKey().defaultRandom(),
    code: varchar({ length: 16 }).notNull(),
    nameId: varchar({ length: 160 }).notNull(),
    nameEn: varchar({ length: 160 }).notNull(),
    ...activeFlag,
    ...timestamps,
  },
  (t) => [uniqueIndex("departments_code_uq").on(t.code)],
);

export const soechiEntities = pgTable("soechi_entities", {
  id: uuid().primaryKey().defaultRandom(),
  nameId: varchar({ length: 200 }).notNull(),
  nameEn: varchar({ length: 200 }).notNull(),
  ...activeFlag,
  ...timestamps,
});

export const vessels = pgTable(
  "vessels",
  {
    id: uuid().primaryKey().defaultRandom(),
    code: varchar({ length: 24 }).notNull(),
    name: varchar({ length: 160 }).notNull(),
    type: varchar({ length: 80 }),
    ...activeFlag,
    ...timestamps,
  },
  (t) => [uniqueIndex("vessels_code_uq").on(t.code)],
);

export const ports = pgTable(
  "ports",
  {
    id: uuid().primaryKey().defaultRandom(),
    code: varchar({ length: 8 }).notNull(),
    name: varchar({ length: 160 }).notNull(),
    countryId: uuid().references(() => countries.id),
    tz: varchar({ length: 12 }),
    lat: varchar({ length: 16 }),
    lon: varchar({ length: 16 }),
    ...activeFlag,
    ...timestamps,
  },
  (t) => [uniqueIndex("ports_code_uq").on(t.code)],
);

export const taxCodes = pgTable(
  "tax_codes",
  {
    id: uuid().primaryKey().defaultRandom(),
    code: varchar({ length: 24 }).notNull(),
    labelId: varchar({ length: 200 }).notNull(),
    labelEn: varchar({ length: 200 }).notNull(),
    rate: varchar({ length: 24 }),
    basis: varchar({ length: 120 }),
    appliesTo: docAppliesToEnum().notNull(),
    ...activeFlag,
    ...timestamps,
  },
  (t) => [uniqueIndex("tax_codes_code_uq").on(t.code)],
);

export const slaThresholds = pgTable("sla_thresholds", {
  id: uuid().primaryKey().defaultRandom(),
  stageId: varchar({ length: 160 }).notNull(),
  stageEn: varchar({ length: 160 }).notNull(),
  target: varchar({ length: 40 }),
  warnAt: varchar({ length: 40 }),
  email: boolean().notNull().default(false),
  ...activeFlag,
  ...timestamps,
});
