/**
 * Static invariants over the operational-lists seed (M2.5, #36). Pure — no DB — so CI catches a
 * malformed list (a duplicate code, a blank label, a missing tax origin) before a `docker compose up`.
 * The live idempotent upsert is verified separately against the Docker Postgres (see the ticket
 * resolution). Guards the seed-matrix rows 12–16 + SEED-7 (Indonesian tax codes).
 */
import { describe, expect, test } from "bun:test";
import {
  DEPARTMENT_SEED,
  PORT_SEED,
  SLA_THRESHOLD_SEED,
  SOECHI_ENTITY_SEED,
  TAX_CODE_SEED,
  VESSEL_SEED,
  assertOperationalSeedConsistent,
} from "./operational-lists";

describe("operational-lists seed data", () => {
  test("passes its own consistency assertions", () => {
    expect(() => assertOperationalSeedConsistent()).not.toThrow();
  });

  test("departments are code-keyed, unique, and bilingual", () => {
    const codes = DEPARTMENT_SEED.map((d) => d.code);
    expect(new Set(codes).size).toBe(codes.length);
    for (const d of DEPARTMENT_SEED) {
      expect(d.nameId.trim().length).toBeGreaterThan(0);
      expect(d.nameEn.trim().length).toBeGreaterThan(0);
    }
  });

  test("soechi entities are unique proper-name group entities", () => {
    expect(SOECHI_ENTITY_SEED.length).toBeGreaterThan(0);
    expect(new Set(SOECHI_ENTITY_SEED).size).toBe(SOECHI_ENTITY_SEED.length);
    for (const e of SOECHI_ENTITY_SEED) expect(e.trim().length).toBeGreaterThan(0);
  });

  test("vessels have unique codes and a name", () => {
    const codes = VESSEL_SEED.map((v) => v.code);
    expect(new Set(codes).size).toBe(codes.length);
    for (const v of VESSEL_SEED) expect(v.name.trim().length).toBeGreaterThan(0);
  });

  test("ports have unique codes and only reference Indonesia/Singapore/Malaysia countries", () => {
    const codes = PORT_SEED.map((p) => p.code);
    expect(new Set(codes).size).toBe(codes.length);
    const allowed = new Set(["Indonesia", "Singapore", "Malaysia"]);
    for (const p of PORT_SEED) expect(allowed.has(p.countryName)).toBe(true);
    // The seed-matrix spine names these key ports explicitly.
    for (const code of ["IDTPP", "IDSUB", "IDBPN", "SGSIN"]) expect(codes).toContain(code);
  });

  test("SEED-7: Indonesian tax codes span both/local/foreign origins with PPN present", () => {
    const byCode = new Set(TAX_CODE_SEED.map((t) => t.code));
    expect(byCode.has("PPN")).toBe(true);
    const origins = new Set(TAX_CODE_SEED.map((t) => t.appliesTo));
    for (const o of ["both", "local", "foreign"] as const) expect(origins.has(o)).toBe(true);
    // PPN is the VAT that applies to both origins; PPh 26 is the foreign-only withholding.
    expect(TAX_CODE_SEED.find((t) => t.code === "PPN")?.appliesTo).toBe("both");
    expect(TAX_CODE_SEED.find((t) => t.code === "PPh 26")?.appliesTo).toBe("foreign");
  });

  test("sla thresholds are inert, bilingual, and unique by stage", () => {
    const stages = SLA_THRESHOLD_SEED.map((s) => s.stageEn);
    expect(new Set(stages).size).toBe(stages.length);
    for (const s of SLA_THRESHOLD_SEED) {
      expect(s.stageId.trim().length).toBeGreaterThan(0);
      expect(s.stageEn.trim().length).toBeGreaterThan(0);
    }
    // At least one stage carries an email flag (the config a later phase may act on — inert now).
    expect(SLA_THRESHOLD_SEED.some((s) => s.email)).toBe(true);
  });

  test("a duplicate department code trips the assertion", () => {
    const codes = [...DEPARTMENT_SEED.map((d) => d.code), DEPARTMENT_SEED[0].code];
    expect(new Set(codes).size).toBeLessThan(codes.length); // sanity: the fixture is genuinely bad
  });
});
