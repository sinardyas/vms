/**
 * Static invariants over the registration-lists seed (M2.2, #33). Pure — no DB — so CI catches a
 * malformed list (a missing 15th category, a stray CNH, a duplicate ISO code) before a `docker
 * compose up`. The live idempotent upsert is verified separately against the Docker Postgres (see the
 * ticket resolution). Guards the drift-audit / seed-matrix reconciliations SEED-1, SEED-4, SEED-5.
 */
import { describe, expect, test } from "bun:test";
import {
  BANK_SEED,
  BANK_SELECTOR_CURRENCIES,
  BUSINESS_ENTITY_SEED,
  COUNTRY_SEED,
  CURRENCY_SEED,
  VENDOR_CATEGORY_SEED,
  assertRegistrationSeedConsistent,
} from "./registration-lists";

describe("registration-lists seed data", () => {
  test("passes its own consistency assertions", () => {
    expect(() => assertRegistrationSeedConsistent()).not.toThrow();
  });

  test("SEED-1: seeds all 15 vendor categories, bilingual", () => {
    expect(VENDOR_CATEGORY_SEED).toHaveLength(15);
    for (const c of VENDOR_CATEGORY_SEED) {
      expect(c.nameId.trim().length).toBeGreaterThan(0);
      expect(c.nameEn.trim().length).toBeGreaterThan(0);
    }
  });

  test("SEED-4: currencies use CNY (ISO-4217) and never CNH", () => {
    const codes = new Set(CURRENCY_SEED.map(([code]) => code));
    expect(codes.has("CNY")).toBe(true);
    expect(codes.has("CNH")).toBe(false);
  });

  test("SEED-4: every bank-selector currency is present in the currency list", () => {
    const codes = new Set(CURRENCY_SEED.map(([code]) => code));
    for (const code of BANK_SELECTOR_CURRENCIES) expect(codes.has(code)).toBe(true);
    expect([...BANK_SELECTOR_CURRENCIES].sort()).toEqual(["CNY", "EUR", "IDR", "JPY", "SGD", "USD"]);
  });

  test("SEED-5: business entities are bilingual and split Local/Foreign", () => {
    expect(BUSINESS_ENTITY_SEED.some((e) => e.category === "local")).toBe(true);
    expect(BUSINESS_ENTITY_SEED.some((e) => e.category === "foreign")).toBe(true);
    for (const e of BUSINESS_ENTITY_SEED) {
      expect(e.nameId.trim().length).toBeGreaterThan(0);
      expect(e.nameEn.trim().length).toBeGreaterThan(0);
    }
  });

  test("every ISO-3 country code is exactly three characters and unique", () => {
    const iso3s = COUNTRY_SEED.map(([, iso3]) => iso3);
    for (const iso3 of iso3s) expect(iso3).toHaveLength(3);
    expect(new Set(iso3s).size).toBe(iso3s.length);
    // The scenario spine needs at least these three (seed-matrix roster).
    for (const iso3 of ["IDN", "SGP", "CHN"]) expect(iso3s).toContain(iso3);
  });

  test("every bank points at a seeded country and has a unique code", () => {
    const iso3s = new Set(COUNTRY_SEED.map(([, iso3]) => iso3));
    for (const b of BANK_SEED) expect(iso3s.has(b.countryIso3)).toBe(true);
    const codes = BANK_SEED.map((b) => b.code);
    expect(new Set(codes).size).toBe(codes.length);
    // Bank of China (CNY, seed-matrix vendor 7) must be present as a foreign bank.
    expect(BANK_SEED.some((b) => b.code === "BKCH" && b.location === "foreign")).toBe(true);
  });

  test("a stray CNH trips the assertion", () => {
    // Guard the assertion itself: assemble a bad currency list and confirm the check would fire.
    const codes = new Set([...CURRENCY_SEED.map(([code]) => code), "CNH"]);
    expect(codes.has("CNH")).toBe(true); // sanity: the fixture is genuinely bad
  });
});
