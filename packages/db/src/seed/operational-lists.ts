/**
 * Operational-lists seed (M2.5, #36) — the six behaviorally-inert reference lists (ADR-0002) loaded so
 * a fresh `docker compose up` lands testers on populated Operational Lists screens. Folds in the
 * seed-matrix (#10) rows 12–16 + `tax_codes` (SEED-7) and the drift §G group-entity list. **Inert:**
 * `sla_thresholds` is seeded as config only — nothing in Phase-0 acts on it (no live timers).
 *
 * Idempotent (re-runnable on every boot): the code-keyed lists (`departments`, `vessels`, `ports`,
 * `tax_codes`) upsert on their unique `code`; the two label-only lists (`soechi_entities`,
 * `sla_thresholds`) have no unique column, so they upsert by matching their English label — insert when
 * absent, refresh + reactivate when present. Re-seeding sets `active: true` on every referenced row (the
 * "seed activates every row it references" rule, seed-matrix §0). Ports resolve their optional
 * `country_id` from the countries seeded by `seedRegistrationLists`, so this must run **after** it.
 */

import { eq } from "drizzle-orm";
import type { DB } from "../index";
import {
  countries,
  departments,
  ports,
  slaThresholds,
  soechiEntities,
  taxCodes,
  vessels,
} from "../schema/master-data";

/* ── Departments — code-keyed, bilingual (AP/Finance, Procurement, HOD-owning depts) ─ */

/** `{ code, nameId, nameEn }` — the Soechi org departments (from the prototype console master). */
export const DEPARTMENT_SEED: readonly {
  readonly code: string;
  readonly nameId: string;
  readonly nameEn: string;
}[] = [
  { code: "FIN", nameId: "Keuangan", nameEn: "Finance" },
  { code: "PROC", nameId: "Pengadaan", nameEn: "Procurement" },
  { code: "ENG", nameId: "Teknik", nameEn: "Engineering" },
  { code: "FLT", nameId: "Manajemen Armada", nameEn: "Fleet Management" },
  { code: "IT", nameId: "Teknologi Informasi", nameEn: "Information Technology" },
  { code: "HSE", nameId: "K3 & Lingkungan", nameEn: "Health, Safety & Environment" },
];

/* ── Soechi entities — group buyer entities (ADR-0006), proper names (id == en) ────── */

/** The Soechi Lines Group buyer entities (drift §G). Proper names, so `name_id` == `name_en`. */
export const SOECHI_ENTITY_SEED: readonly string[] = [
  "PT Soechi Lines Tbk",
  "PT Sukses Osean Khatulistiwa Line",
  "PT Armada Bumi Pratiwi Lines",
  "PT Multi Ocean Shipyard",
  "PT Armada Maritime System",
];

/* ── Vessels — code-keyed; single name + type (a handful of Soechi tankers) ───────── */

/** `{ code, name, type }` — Soechi fleet sample (from the prototype console master). */
export const VESSEL_SEED: readonly {
  readonly code: string;
  readonly name: string;
  readonly type: string;
}[] = [
  { code: "MT-ASIA", name: "MT Soechi Asia", type: "Oil Tanker" },
  { code: "MT-CHEM19", name: "MT Soechi Chemical XIX", type: "Chemical Tanker" },
  { code: "MT-LINESV", name: "MT Soechi Lines V", type: "Product Tanker" },
  { code: "MT-GAS03", name: "MT Soechi Gas III", type: "LPG Carrier" },
  { code: "TB-NUSA07", name: "TB Nusantara 07", type: "Tug Boat" },
];

/* ── Ports — code-keyed; name + country (by name) + tz + lat/lon (key IDN + regional) ─ */

/** `{ code, name, countryName, tz, lat, lon }` — key Indonesian ports + regional hubs. */
export const PORT_SEED: readonly {
  readonly code: string;
  readonly name: string;
  readonly countryName: string;
  readonly tz: string;
  readonly lat: string;
  readonly lon: string;
}[] = [
  { code: "IDTPP", name: "Tanjung Priok", countryName: "Indonesia", tz: "UTC+7", lat: "-6.1045", lon: "106.8803" },
  { code: "IDSUB", name: "Tanjung Perak (Surabaya)", countryName: "Indonesia", tz: "UTC+7", lat: "-7.2016", lon: "112.7311" },
  { code: "IDBPN", name: "Balikpapan", countryName: "Indonesia", tz: "UTC+8", lat: "-1.2662", lon: "116.8003" },
  { code: "IDBTM", name: "Batam", countryName: "Indonesia", tz: "UTC+7", lat: "1.0790", lon: "104.0305" },
  { code: "IDMAK", name: "Makassar", countryName: "Indonesia", tz: "UTC+8", lat: "-5.1170", lon: "119.4110" },
  { code: "IDBLW", name: "Belawan", countryName: "Indonesia", tz: "UTC+7", lat: "3.7910", lon: "98.6870" },
  { code: "IDSRI", name: "Tanjung Emas (Semarang)", countryName: "Indonesia", tz: "UTC+7", lat: "-6.9490", lon: "110.4280" },
  { code: "SGSIN", name: "Port of Singapore", countryName: "Singapore", tz: "UTC+8", lat: "1.2644", lon: "103.8400" },
  { code: "MYPKG", name: "Port Klang", countryName: "Malaysia", tz: "UTC+8", lat: "3.0000", lon: "101.4000" },
  { code: "MYTPP", name: "Tanjung Pelepas", countryName: "Malaysia", tz: "UTC+8", lat: "1.3620", lon: "103.5500" },
];

/* ── Tax codes — code-keyed, bilingual label + rate/basis + origin (SEED-7) ────────── */

/** `{ code, labelId, labelEn, rate, basis, appliesTo }` — Indonesian tax codes (SEED-7). */
export const TAX_CODE_SEED: readonly {
  readonly code: string;
  readonly labelId: string;
  readonly labelEn: string;
  readonly rate: string;
  readonly basis: string;
  readonly appliesTo: "local" | "foreign" | "both";
}[] = [
  {
    code: "PPN",
    labelId: "Pajak Pertambahan Nilai",
    labelEn: "Value-Added Tax",
    rate: "11%",
    basis: "On taxable base (DPP)",
    appliesTo: "both",
  },
  {
    code: "PPh 23",
    labelId: "PPh Pasal 23 — jasa",
    labelEn: "Withholding — services",
    rate: "2%",
    basis: "On gross (non-final)",
    appliesTo: "local",
  },
  {
    code: "PPh 4(2)",
    labelId: "PPh Pasal 4 ayat 2 — final",
    labelEn: "Withholding — final",
    rate: "Varies",
    basis: "Construction, rental",
    appliesTo: "local",
  },
  {
    code: "PPh 21",
    labelId: "PPh Pasal 21 — orang pribadi",
    labelEn: "Withholding — individuals",
    rate: "Progressive",
    basis: "Personal services",
    appliesTo: "local",
  },
  {
    code: "PPh 26",
    labelId: "PPh Pasal 26 — luar negeri",
    labelEn: "Withholding — foreign",
    rate: "20%",
    basis: "Payment to non-residents",
    appliesTo: "foreign",
  },
];

/* ── SLA thresholds — bilingual stage + target/warn + email (INERT config, ADR-0002) ─ */

/** `{ stageId, stageEn, target, warnAt, email }` — inert SLA config (nothing acts on it in Phase-0). */
export const SLA_THRESHOLD_SEED: readonly {
  readonly stageId: string;
  readonly stageEn: string;
  readonly target: string;
  readonly warnAt: string;
  readonly email: boolean;
}[] = [
  {
    stageId: "Verifikasi Dokumen / Pajak",
    stageEn: "Document / Tax Verification",
    target: "2 business days",
    warnAt: "1 day",
    email: true,
  },
  {
    stageId: "Persetujuan Pemilik Biaya / Anggaran",
    stageEn: "Cost / Budget Owner Approval",
    target: "3 business days",
    warnAt: "1 day",
    email: true,
  },
  {
    stageId: "Persetujuan Akhir",
    stageEn: "Final Approval",
    target: "2 business days",
    warnAt: "1 day",
    email: false,
  },
  {
    stageId: "Bendahara — Penjadwalan Pembayaran",
    stageEn: "Treasury — Payment Scheduling",
    target: "5 business days",
    warnAt: "2 days",
    email: true,
  },
];

/**
 * Static invariants over the seed data, checked before any write so a malformed list fails loudly
 * (and is unit-tested without a DB in `operational-lists.test.ts`): no duplicate code / label within a
 * list, every bilingual side non-blank, and the two behaviourally-load-bearing invariants — the SEED-7
 * tax set (PPN present, spanning `both`/`local`/`foreign`) and every port pointing at a resolvable
 * country name.
 */
export const assertOperationalSeedConsistent = (): void => {
  const dup = (label: string, values: readonly string[]): void => {
    const seen = new Set<string>();
    for (const v of values) {
      if (seen.has(v)) throw new Error(`[seed] duplicate ${label}: ${v}`);
      seen.add(v);
    }
  };

  dup("department code", DEPARTMENT_SEED.map((d) => d.code));
  dup("soechi entity name", SOECHI_ENTITY_SEED);
  dup("vessel code", VESSEL_SEED.map((v) => v.code));
  dup("port code", PORT_SEED.map((p) => p.code));
  dup("tax code", TAX_CODE_SEED.map((t) => t.code));
  dup("sla stage", SLA_THRESHOLD_SEED.map((s) => s.stageEn));

  for (const d of DEPARTMENT_SEED)
    if (!d.nameId.trim() || !d.nameEn.trim())
      throw new Error(`[seed] department "${d.code}" has a blank label`);
  for (const e of SOECHI_ENTITY_SEED)
    if (!e.trim()) throw new Error("[seed] soechi entity has a blank name");
  for (const t of TAX_CODE_SEED)
    if (!t.labelId.trim() || !t.labelEn.trim())
      throw new Error(`[seed] tax code "${t.code}" has a blank label`);
  for (const s of SLA_THRESHOLD_SEED)
    if (!s.stageId.trim() || !s.stageEn.trim())
      throw new Error("[seed] sla threshold has a blank stage label");

  // SEED-7: PPN present and applies to both origins; the withholding codes cover local + foreign.
  const taxCodesById = new Set(TAX_CODE_SEED.map((t) => t.code));
  if (!taxCodesById.has("PPN")) throw new Error("[seed] tax code PPN is missing (SEED-7)");
  const origins = new Set(TAX_CODE_SEED.map((t) => t.appliesTo));
  for (const o of ["both", "local", "foreign"] as const)
    if (!origins.has(o)) throw new Error(`[seed] tax codes miss the "${o}" origin (SEED-7)`);
};

/**
 * Seed (or re-seed) the six operational lists. Idempotent — code-keyed lists upsert on their unique
 * index; the label-only lists upsert by matching their English label. Returns per-list row counts for
 * the log. Must run after `seedRegistrationLists` (ports resolve `country_id` from seeded countries).
 */
export const seedOperationalLists = async (
  db: DB,
): Promise<{
  departments: number;
  soechiEntities: number;
  vessels: number;
  ports: number;
  taxCodes: number;
  slaThresholds: number;
}> => {
  assertOperationalSeedConsistent();

  for (const d of DEPARTMENT_SEED) {
    await db
      .insert(departments)
      .values({ code: d.code, nameId: d.nameId, nameEn: d.nameEn })
      .onConflictDoUpdate({
        target: departments.code,
        set: { nameId: d.nameId, nameEn: d.nameEn, active: true, updatedAt: new Date() },
      });
  }

  for (const v of VESSEL_SEED) {
    await db
      .insert(vessels)
      .values({ code: v.code, name: v.name, type: v.type })
      .onConflictDoUpdate({
        target: vessels.code,
        set: { name: v.name, type: v.type, active: true, updatedAt: new Date() },
      });
  }

  // Ports resolve their optional country_id from the countries seeded by seedRegistrationLists.
  const countryRows = await db.select({ id: countries.id, name: countries.name }).from(countries);
  const countryIdByName = new Map(countryRows.map((r) => [r.name, r.id]));

  for (const p of PORT_SEED) {
    const countryId = countryIdByName.get(p.countryName) ?? null;
    await db
      .insert(ports)
      .values({ code: p.code, name: p.name, countryId, tz: p.tz, lat: p.lat, lon: p.lon })
      .onConflictDoUpdate({
        target: ports.code,
        set: {
          name: p.name,
          countryId,
          tz: p.tz,
          lat: p.lat,
          lon: p.lon,
          active: true,
          updatedAt: new Date(),
        },
      });
  }

  for (const t of TAX_CODE_SEED) {
    await db
      .insert(taxCodes)
      .values({
        code: t.code,
        labelId: t.labelId,
        labelEn: t.labelEn,
        rate: t.rate,
        basis: t.basis,
        appliesTo: t.appliesTo,
      })
      .onConflictDoUpdate({
        target: taxCodes.code,
        set: {
          labelId: t.labelId,
          labelEn: t.labelEn,
          rate: t.rate,
          basis: t.basis,
          appliesTo: t.appliesTo,
          active: true,
          updatedAt: new Date(),
        },
      });
  }

  // Label-only lists have no unique column: match by English label, insert if absent, else refresh.
  for (const name of SOECHI_ENTITY_SEED) {
    const [existing] = await db
      .select({ id: soechiEntities.id })
      .from(soechiEntities)
      .where(eq(soechiEntities.nameEn, name))
      .limit(1);
    if (existing) {
      await db
        .update(soechiEntities)
        .set({ nameId: name, active: true, updatedAt: new Date() })
        .where(eq(soechiEntities.id, existing.id));
    } else {
      await db.insert(soechiEntities).values({ nameId: name, nameEn: name });
    }
  }

  for (const s of SLA_THRESHOLD_SEED) {
    const [existing] = await db
      .select({ id: slaThresholds.id })
      .from(slaThresholds)
      .where(eq(slaThresholds.stageEn, s.stageEn))
      .limit(1);
    if (existing) {
      await db
        .update(slaThresholds)
        .set({
          stageId: s.stageId,
          target: s.target,
          warnAt: s.warnAt,
          email: s.email,
          active: true,
          updatedAt: new Date(),
        })
        .where(eq(slaThresholds.id, existing.id));
    } else {
      await db.insert(slaThresholds).values({
        stageId: s.stageId,
        stageEn: s.stageEn,
        target: s.target,
        warnAt: s.warnAt,
        email: s.email,
      });
    }
  }

  return {
    departments: DEPARTMENT_SEED.length,
    soechiEntities: SOECHI_ENTITY_SEED.length,
    vessels: VESSEL_SEED.length,
    ports: PORT_SEED.length,
    taxCodes: TAX_CODE_SEED.length,
    slaThresholds: SLA_THRESHOLD_SEED.length,
  };
};
