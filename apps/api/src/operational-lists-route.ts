/**
 * Operational lists (M2.5, #36, ADR-0002/0006) — the six **behaviorally-inert** reference lists the
 * console manages but nothing in Phase-0 acts on: `departments`, `soechi_entities`, `vessels`, `ports`,
 * `tax_codes`, `sla_thresholds`. Each is a thin **instantiation** of the M2.1 master framework
 * (`masterListRoutes` + `drizzleMasterStore`, #32) — a list is *config* (its RBAC module, Zod
 * create/update schemas, table, and small mappers), not a re-implementation. So soft-delete (deactivate
 * hides from any future capture path but keeps the row so a reference could still resolve), bilingual
 * labels, unique-clash 409s, RBAC gating on `operational_lists`, and atomic audit are all inherited.
 *
 * **Inert by design (ADR-0002):** Phase-0 *stores and manages* these; no workflow reads them yet.
 * `sla_thresholds` in particular is captured but **not enforced** — the SLA figures are config a later
 * phase may act on, never a live timer here. That inertness is a scope decision, not a TODO: no code
 * should wire behaviour onto these tables in Phase-0.
 *
 * Two label shapes (ADR-0011): `departments` / `soechi_entities` name a *term*, so they carry a
 * bilingual `name_id` / `name_en` pair; `tax_codes` / `sla_thresholds` carry their own bilingual pair
 * under domain-specific column names (`label_id`/`label_en`, `stage_id`/`stage_en`). `vessels` / `ports`
 * are proper-name lists with a single `name`. The code-keyed lists (`departments`, `vessels`, `ports`,
 * `tax_codes`) carry a unique `code` that drives the 409; like a role's `code` it is **create-only** —
 * not part of the update body — so an edit can never collide against the DB unique index.
 */

import { departments, ports, slaThresholds, soechiEntities, taxCodes, vessels } from "@vms/db";
import {
  type DocAppliesTo,
  bilingualLabelFields,
  bilingualLabelPatchFields,
  docAppliesToSchema,
} from "@vms/domain";
import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "./context";
import { type MasterDTO, masterListRoutes } from "./master-list";
import { drizzleMasterStore } from "./master-store";

/** Every operational list gates on the same RBAC module (ADR-0012). */
const MODULE = "operational_lists" as const;

/** A required, trimmed, length-capped string (matches a `varchar(max)` column). */
const str = (max: number) => z.string().trim().min(1).max(max);
/** An optional, trimmed string that normalises blank/absent to `null` (a nullable column). */
const optStr = (max: number) => z.string().trim().max(max).nullable().optional();

/* ── departments — code (create-only) + bilingual term ───────────────────────── */

export type DepartmentDTO = MasterDTO & {
  readonly code: string;
  readonly nameId: string;
  readonly nameEn: string;
};
export const departmentCreate = z.object({ code: str(16), ...bilingualLabelFields(160) });
export const departmentUpdate = z.object(bilingualLabelPatchFields(160));
type DepartmentCreate = z.infer<typeof departmentCreate>;
type DepartmentUpdate = z.infer<typeof departmentUpdate>;

const departmentStore = drizzleMasterStore({
  table: departments,
  idColumn: departments.id,
  activeColumn: departments.active,
  orderBy: departments.code,
  module: MODULE,
  subjectType: "department",
  unique: { column: departments.code, valueOf: (i: DepartmentCreate) => i.code },
  insertValues: (i: DepartmentCreate) => ({ code: i.code, nameId: i.nameId, nameEn: i.nameEn }),
  updateValues: (p: DepartmentUpdate) => ({
    ...(p.nameId !== undefined ? { nameId: p.nameId } : {}),
    ...(p.nameEn !== undefined ? { nameEn: p.nameEn } : {}),
  }),
  toDTO: (r): DepartmentDTO => ({
    id: r.id,
    active: r.active,
    code: r.code,
    nameId: r.nameId,
    nameEn: r.nameEn,
  }),
});

/* ── soechi_entities — bilingual term only (group buyer entities, ADR-0006) ───── */

export type SoechiEntityDTO = MasterDTO & { readonly nameId: string; readonly nameEn: string };
export const soechiEntityCreate = z.object(bilingualLabelFields(200));
export const soechiEntityUpdate = z.object(bilingualLabelPatchFields(200));
type SoechiEntityCreate = z.infer<typeof soechiEntityCreate>;
type SoechiEntityUpdate = z.infer<typeof soechiEntityUpdate>;

const soechiEntityStore = drizzleMasterStore({
  table: soechiEntities,
  idColumn: soechiEntities.id,
  activeColumn: soechiEntities.active,
  orderBy: soechiEntities.nameEn,
  module: MODULE,
  subjectType: "soechi_entity",
  insertValues: (i: SoechiEntityCreate) => ({ nameId: i.nameId, nameEn: i.nameEn }),
  updateValues: (p: SoechiEntityUpdate) => ({
    ...(p.nameId !== undefined ? { nameId: p.nameId } : {}),
    ...(p.nameEn !== undefined ? { nameEn: p.nameEn } : {}),
  }),
  toDTO: (r): SoechiEntityDTO => ({
    id: r.id,
    active: r.active,
    nameId: r.nameId,
    nameEn: r.nameEn,
  }),
});

/* ── vessels — code (create-only) + name + optional type ─────────────────────── */

export type VesselDTO = MasterDTO & {
  readonly code: string;
  readonly name: string;
  readonly type: string | null;
};
export const vesselCreate = z.object({ code: str(24), name: str(160), type: optStr(80) });
export const vesselUpdate = z.object({ name: str(160).optional(), type: optStr(80) });
type VesselCreate = z.infer<typeof vesselCreate>;
type VesselUpdate = z.infer<typeof vesselUpdate>;

const vesselStore = drizzleMasterStore({
  table: vessels,
  idColumn: vessels.id,
  activeColumn: vessels.active,
  orderBy: vessels.code,
  module: MODULE,
  subjectType: "vessel",
  unique: { column: vessels.code, valueOf: (i: VesselCreate) => i.code },
  insertValues: (i: VesselCreate) => ({ code: i.code, name: i.name, type: i.type ?? null }),
  updateValues: (p: VesselUpdate) => ({
    ...(p.name !== undefined ? { name: p.name } : {}),
    ...(p.type !== undefined ? { type: p.type } : {}),
  }),
  toDTO: (r): VesselDTO => ({
    id: r.id,
    active: r.active,
    code: r.code,
    name: r.name,
    type: r.type,
  }),
});

/* ── ports — code (create-only) + name + optional country FK / tz / lat / lon ─── */

export type PortDTO = MasterDTO & {
  readonly code: string;
  readonly name: string;
  readonly countryId: string | null;
  readonly tz: string | null;
  readonly lat: string | null;
  readonly lon: string | null;
};
export const portCreate = z.object({
  code: str(8),
  name: str(160),
  countryId: z.string().uuid().nullable().optional(),
  tz: optStr(12),
  lat: optStr(16),
  lon: optStr(16),
});
export const portUpdate = z.object({
  name: str(160).optional(),
  countryId: z.string().uuid().nullable().optional(),
  tz: optStr(12),
  lat: optStr(16),
  lon: optStr(16),
});
type PortCreate = z.infer<typeof portCreate>;
type PortUpdate = z.infer<typeof portUpdate>;

const portStore = drizzleMasterStore({
  table: ports,
  idColumn: ports.id,
  activeColumn: ports.active,
  orderBy: ports.code,
  module: MODULE,
  subjectType: "port",
  unique: { column: ports.code, valueOf: (i: PortCreate) => i.code },
  insertValues: (i: PortCreate) => ({
    code: i.code,
    name: i.name,
    countryId: i.countryId ?? null,
    tz: i.tz ?? null,
    lat: i.lat ?? null,
    lon: i.lon ?? null,
  }),
  updateValues: (p: PortUpdate) => ({
    ...(p.name !== undefined ? { name: p.name } : {}),
    ...(p.countryId !== undefined ? { countryId: p.countryId } : {}),
    ...(p.tz !== undefined ? { tz: p.tz } : {}),
    ...(p.lat !== undefined ? { lat: p.lat } : {}),
    ...(p.lon !== undefined ? { lon: p.lon } : {}),
  }),
  toDTO: (r): PortDTO => ({
    id: r.id,
    active: r.active,
    code: r.code,
    name: r.name,
    countryId: r.countryId,
    tz: r.tz,
    lat: r.lat,
    lon: r.lon,
  }),
});

/* ── tax_codes — code (create-only) + bilingual label + rate/basis + origin ───── */

export type TaxCodeDTO = MasterDTO & {
  readonly code: string;
  readonly labelId: string;
  readonly labelEn: string;
  readonly rate: string | null;
  readonly basis: string | null;
  readonly appliesTo: DocAppliesTo;
};
export const taxCodeCreate = z.object({
  code: str(24),
  labelId: str(200),
  labelEn: str(200),
  rate: optStr(24),
  basis: optStr(120),
  appliesTo: docAppliesToSchema,
});
export const taxCodeUpdate = z.object({
  labelId: str(200).optional(),
  labelEn: str(200).optional(),
  rate: optStr(24),
  basis: optStr(120),
  appliesTo: docAppliesToSchema.optional(),
});
type TaxCodeCreate = z.infer<typeof taxCodeCreate>;
type TaxCodeUpdate = z.infer<typeof taxCodeUpdate>;

const taxCodeStore = drizzleMasterStore({
  table: taxCodes,
  idColumn: taxCodes.id,
  activeColumn: taxCodes.active,
  orderBy: taxCodes.code,
  module: MODULE,
  subjectType: "tax_code",
  unique: { column: taxCodes.code, valueOf: (i: TaxCodeCreate) => i.code },
  insertValues: (i: TaxCodeCreate) => ({
    code: i.code,
    labelId: i.labelId,
    labelEn: i.labelEn,
    rate: i.rate ?? null,
    basis: i.basis ?? null,
    appliesTo: i.appliesTo,
  }),
  updateValues: (p: TaxCodeUpdate) => ({
    ...(p.labelId !== undefined ? { labelId: p.labelId } : {}),
    ...(p.labelEn !== undefined ? { labelEn: p.labelEn } : {}),
    ...(p.rate !== undefined ? { rate: p.rate } : {}),
    ...(p.basis !== undefined ? { basis: p.basis } : {}),
    ...(p.appliesTo !== undefined ? { appliesTo: p.appliesTo } : {}),
  }),
  toDTO: (r): TaxCodeDTO => ({
    id: r.id,
    active: r.active,
    code: r.code,
    labelId: r.labelId,
    labelEn: r.labelEn,
    rate: r.rate,
    basis: r.basis,
    appliesTo: r.appliesTo,
  }),
});

/* ── sla_thresholds — bilingual stage + target/warn + email flag (INERT) ──────── */

export type SlaThresholdDTO = MasterDTO & {
  readonly stageId: string;
  readonly stageEn: string;
  readonly target: string | null;
  readonly warnAt: string | null;
  readonly email: boolean;
};
export const slaThresholdCreate = z.object({
  stageId: str(160),
  stageEn: str(160),
  target: optStr(40),
  warnAt: optStr(40),
  email: z.boolean().optional(),
});
export const slaThresholdUpdate = z.object({
  stageId: str(160).optional(),
  stageEn: str(160).optional(),
  target: optStr(40),
  warnAt: optStr(40),
  email: z.boolean().optional(),
});
type SlaThresholdCreate = z.infer<typeof slaThresholdCreate>;
type SlaThresholdUpdate = z.infer<typeof slaThresholdUpdate>;

const slaThresholdStore = drizzleMasterStore({
  table: slaThresholds,
  idColumn: slaThresholds.id,
  activeColumn: slaThresholds.active,
  orderBy: slaThresholds.stageEn,
  module: MODULE,
  subjectType: "sla_threshold",
  insertValues: (i: SlaThresholdCreate) => ({
    stageId: i.stageId,
    stageEn: i.stageEn,
    target: i.target ?? null,
    warnAt: i.warnAt ?? null,
    ...(i.email !== undefined ? { email: i.email } : {}),
  }),
  updateValues: (p: SlaThresholdUpdate) => ({
    ...(p.stageId !== undefined ? { stageId: p.stageId } : {}),
    ...(p.stageEn !== undefined ? { stageEn: p.stageEn } : {}),
    ...(p.target !== undefined ? { target: p.target } : {}),
    ...(p.warnAt !== undefined ? { warnAt: p.warnAt } : {}),
    ...(p.email !== undefined ? { email: p.email } : {}),
  }),
  toDTO: (r): SlaThresholdDTO => ({
    id: r.id,
    active: r.active,
    stageId: r.stageId,
    stageEn: r.stageEn,
    target: r.target,
    warnAt: r.warnAt,
    email: r.email,
  }),
});

/**
 * Build the `/console/operational-lists` router: the six lists, each at its own path segment and each
 * the generic {@link masterListRoutes} over its {@link drizzleMasterStore}. Mount under a parent
 * running the request-context middleware (so the guards + `c.var.ctx` work), as in `apps/api/index`.
 */
export const operationalListRoutes = (): Hono<AppEnv> => {
  const app = new Hono<AppEnv>();

  app.route(
    "/departments",
    masterListRoutes({
      module: MODULE,
      createSchema: departmentCreate,
      updateSchema: departmentUpdate,
      store: departmentStore,
    }),
  );
  app.route(
    "/soechi-entities",
    masterListRoutes({
      module: MODULE,
      createSchema: soechiEntityCreate,
      updateSchema: soechiEntityUpdate,
      store: soechiEntityStore,
    }),
  );
  app.route(
    "/vessels",
    masterListRoutes({
      module: MODULE,
      createSchema: vesselCreate,
      updateSchema: vesselUpdate,
      store: vesselStore,
    }),
  );
  app.route(
    "/ports",
    masterListRoutes({
      module: MODULE,
      createSchema: portCreate,
      updateSchema: portUpdate,
      store: portStore,
    }),
  );
  app.route(
    "/tax-codes",
    masterListRoutes({
      module: MODULE,
      createSchema: taxCodeCreate,
      updateSchema: taxCodeUpdate,
      store: taxCodeStore,
    }),
  );
  app.route(
    "/sla-thresholds",
    masterListRoutes({
      module: MODULE,
      createSchema: slaThresholdCreate,
      updateSchema: slaThresholdUpdate,
      store: slaThresholdStore,
    }),
  );

  return app;
};
