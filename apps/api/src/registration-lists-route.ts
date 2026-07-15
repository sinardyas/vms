/**
 * Registration lists (M2.2, #33, ADR-0006/0011/0013) — the five master lists vendor registration
 * reads its dropdowns from: `business_entities`, `vendor_categories`, `banks`, `currencies`,
 * `countries`. Each is a thin **instantiation** of the M2.1 master framework (`masterListRoutes` +
 * `drizzleMasterStore`, #32): a list is *config* — its RBAC module, Zod create/update schemas, table,
 * and small mappers — not a re-implementation. So soft-delete (deactivate hides from new captures but
 * keeps existing vendor references resolving), bilingual labels, unique-clash 409s, RBAC gating on
 * `registration_lists`, and atomic audit are all inherited by construction.
 *
 * Two shapes of list (ADR-0011): `business_entities` + `vendor_categories` name a *term*, so they
 * carry a bilingual `name_id` / `name_en` pair (composed from `@vms/domain`'s `bilingualLabelFields`);
 * `banks` / `currencies` / `countries` are proper-name/code lists with a single `name` and a unique
 * code (`banks.code`, `currencies.code`, `countries.iso3`) that drives the 409. The unique column is
 * **create-only** — like a role's `code`, it isn't part of the update body, so an edit can never
 * collide against the DB unique index (which the store's pre-check wouldn't catch).
 */

import { banks, businessEntities, countries, currencies, vendorCategories } from "@vms/db";
import {
  type Locality,
  bilingualLabelFields,
  bilingualLabelPatchFields,
  localitySchema,
} from "@vms/domain";
import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "./context";
import { type MasterDTO, masterListRoutes } from "./master-list";
import { drizzleMasterStore } from "./master-store";

/** Every registration list gates on the same RBAC module (ADR-0012). */
const MODULE = "registration_lists" as const;

/** A required, trimmed, length-capped string (matches a `varchar(max)` column). */
const str = (max: number) => z.string().trim().min(1).max(max);

/** An ISO code column (`countries.iso3` / `currencies.code`): exactly `len` chars, upper-cased. */
const isoCode = (len: number) =>
  z
    .string()
    .trim()
    .length(len)
    .transform((s) => s.toUpperCase());

/* ── business_entities — bilingual term + Local/Foreign legal-form locality ─── */

export type BusinessEntityDTO = MasterDTO & {
  readonly nameId: string;
  readonly nameEn: string;
  readonly category: Locality;
};
export const businessEntityCreate = z.object({
  ...bilingualLabelFields(120),
  category: localitySchema,
});
export const businessEntityUpdate = z.object({
  ...bilingualLabelPatchFields(120),
  category: localitySchema.optional(),
});
type BusinessEntityCreate = z.infer<typeof businessEntityCreate>;
type BusinessEntityUpdate = z.infer<typeof businessEntityUpdate>;

const businessEntityStore = drizzleMasterStore({
  table: businessEntities,
  idColumn: businessEntities.id,
  activeColumn: businessEntities.active,
  orderBy: businessEntities.nameEn,
  module: MODULE,
  subjectType: "business_entity",
  insertValues: (i: BusinessEntityCreate) => ({
    nameId: i.nameId,
    nameEn: i.nameEn,
    category: i.category,
  }),
  updateValues: (p: BusinessEntityUpdate) => ({
    ...(p.nameId !== undefined ? { nameId: p.nameId } : {}),
    ...(p.nameEn !== undefined ? { nameEn: p.nameEn } : {}),
    ...(p.category !== undefined ? { category: p.category } : {}),
  }),
  toDTO: (r): BusinessEntityDTO => ({
    id: r.id,
    active: r.active,
    nameId: r.nameId,
    nameEn: r.nameEn,
    category: r.category,
  }),
});

/* ── vendor_categories — bilingual term only ─────────────────────────────────── */

export type VendorCategoryDTO = MasterDTO & { readonly nameId: string; readonly nameEn: string };
export const vendorCategoryCreate = z.object(bilingualLabelFields(160));
export const vendorCategoryUpdate = z.object(bilingualLabelPatchFields(160));
type VendorCategoryCreate = z.infer<typeof vendorCategoryCreate>;
type VendorCategoryUpdate = z.infer<typeof vendorCategoryUpdate>;

const vendorCategoryStore = drizzleMasterStore({
  table: vendorCategories,
  idColumn: vendorCategories.id,
  activeColumn: vendorCategories.active,
  orderBy: vendorCategories.nameEn,
  module: MODULE,
  subjectType: "vendor_category",
  insertValues: (i: VendorCategoryCreate) => ({ nameId: i.nameId, nameEn: i.nameEn }),
  updateValues: (p: VendorCategoryUpdate) => ({
    ...(p.nameId !== undefined ? { nameId: p.nameId } : {}),
    ...(p.nameEn !== undefined ? { nameEn: p.nameEn } : {}),
  }),
  toDTO: (r): VendorCategoryDTO => ({
    id: r.id,
    active: r.active,
    nameId: r.nameId,
    nameEn: r.nameEn,
  }),
});

/* ── countries — single name + unique ISO-3 (create-only) ────────────────────── */

export type CountryDTO = MasterDTO & { readonly name: string; readonly iso3: string };
export const countryCreate = z.object({ name: str(120), iso3: isoCode(3) });
export const countryUpdate = z.object({ name: str(120).optional() });
type CountryCreate = z.infer<typeof countryCreate>;
type CountryUpdate = z.infer<typeof countryUpdate>;

const countryStore = drizzleMasterStore({
  table: countries,
  idColumn: countries.id,
  activeColumn: countries.active,
  orderBy: countries.name,
  module: MODULE,
  subjectType: "country",
  unique: { column: countries.iso3, valueOf: (i: CountryCreate) => i.iso3 },
  insertValues: (i: CountryCreate) => ({ name: i.name, iso3: i.iso3 }),
  updateValues: (p: CountryUpdate) => (p.name !== undefined ? { name: p.name } : {}),
  toDTO: (r): CountryDTO => ({ id: r.id, active: r.active, name: r.name, iso3: r.iso3 }),
});

/* ── currencies — code (create-only) + name + country + bank-selector flag ───── */

export type CurrencyDTO = MasterDTO & {
  readonly code: string;
  readonly name: string;
  readonly country: string | null;
  readonly showInBankSelector: boolean;
};
export const currencyCreate = z.object({
  code: isoCode(3),
  name: str(120),
  country: str(120).nullable().optional(),
  showInBankSelector: z.boolean().optional(),
});
export const currencyUpdate = z.object({
  name: str(120).optional(),
  country: str(120).nullable().optional(),
  showInBankSelector: z.boolean().optional(),
});
type CurrencyCreate = z.infer<typeof currencyCreate>;
type CurrencyUpdate = z.infer<typeof currencyUpdate>;

const currencyStore = drizzleMasterStore({
  table: currencies,
  idColumn: currencies.id,
  activeColumn: currencies.active,
  orderBy: currencies.code,
  module: MODULE,
  subjectType: "currency",
  unique: { column: currencies.code, valueOf: (i: CurrencyCreate) => i.code },
  insertValues: (i: CurrencyCreate) => ({
    code: i.code,
    name: i.name,
    country: i.country ?? null,
    ...(i.showInBankSelector !== undefined ? { showInBankSelector: i.showInBankSelector } : {}),
  }),
  updateValues: (p: CurrencyUpdate) => ({
    ...(p.name !== undefined ? { name: p.name } : {}),
    ...(p.country !== undefined ? { country: p.country } : {}),
    ...(p.showInBankSelector !== undefined ? { showInBankSelector: p.showInBankSelector } : {}),
  }),
  toDTO: (r): CurrencyDTO => ({
    id: r.id,
    active: r.active,
    code: r.code,
    name: r.name,
    country: r.country,
    showInBankSelector: r.showInBankSelector,
  }),
});

/* ── banks — single name + code (create-only) + locality + optional country FK ─ */

export type BankDTO = MasterDTO & {
  readonly name: string;
  readonly code: string;
  readonly location: Locality;
  readonly countryId: string | null;
};
export const bankCreate = z.object({
  name: str(160),
  code: str(16),
  location: localitySchema,
  countryId: z.string().uuid().nullable().optional(),
});
export const bankUpdate = z.object({
  name: str(160).optional(),
  location: localitySchema.optional(),
  countryId: z.string().uuid().nullable().optional(),
});
type BankCreate = z.infer<typeof bankCreate>;
type BankUpdate = z.infer<typeof bankUpdate>;

const bankStore = drizzleMasterStore({
  table: banks,
  idColumn: banks.id,
  activeColumn: banks.active,
  orderBy: banks.name,
  module: MODULE,
  subjectType: "bank",
  unique: { column: banks.code, valueOf: (i: BankCreate) => i.code },
  insertValues: (i: BankCreate) => ({
    name: i.name,
    code: i.code,
    location: i.location,
    countryId: i.countryId ?? null,
  }),
  updateValues: (p: BankUpdate) => ({
    ...(p.name !== undefined ? { name: p.name } : {}),
    ...(p.location !== undefined ? { location: p.location } : {}),
    ...(p.countryId !== undefined ? { countryId: p.countryId } : {}),
  }),
  toDTO: (r): BankDTO => ({
    id: r.id,
    active: r.active,
    name: r.name,
    code: r.code,
    location: r.location,
    countryId: r.countryId,
  }),
});

/**
 * Build the `/console/registration-lists` router: the five lists, each at its own path segment and
 * each the generic {@link masterListRoutes} over its {@link drizzleMasterStore}. Mount under a parent
 * running the request-context middleware (so the guards + `c.var.ctx` work), as in `apps/api/index`.
 */
export const registrationListRoutes = (): Hono<AppEnv> => {
  const app = new Hono<AppEnv>();

  app.route(
    "/business-entities",
    masterListRoutes({
      module: MODULE,
      createSchema: businessEntityCreate,
      updateSchema: businessEntityUpdate,
      store: businessEntityStore,
    }),
  );
  app.route(
    "/vendor-categories",
    masterListRoutes({
      module: MODULE,
      createSchema: vendorCategoryCreate,
      updateSchema: vendorCategoryUpdate,
      store: vendorCategoryStore,
    }),
  );
  app.route(
    "/banks",
    masterListRoutes({
      module: MODULE,
      createSchema: bankCreate,
      updateSchema: bankUpdate,
      store: bankStore,
    }),
  );
  app.route(
    "/currencies",
    masterListRoutes({
      module: MODULE,
      createSchema: currencyCreate,
      updateSchema: currencyUpdate,
      store: currencyStore,
    }),
  );
  app.route(
    "/countries",
    masterListRoutes({
      module: MODULE,
      createSchema: countryCreate,
      updateSchema: countryUpdate,
      store: countryStore,
    }),
  );

  return app;
};
