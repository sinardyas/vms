/**
 * Static invariants over the document-master seed (M2.3, #34). Pure — no DB — so CI catches a
 * malformed list (a gap in DOC-000…020, a bad appliesTo, a requirement pointing at a non-existent
 * doc) before a `docker compose up`. The live idempotent upsert is verified separately against the
 * Docker Postgres (see the ticket resolution). Guards ADR-0013's origin ∪ category required-set shape.
 */
import { describe, expect, test } from "bun:test";
import {
  CATEGORY_REQUIREMENT_SEED,
  DOCUMENT_MASTER_SEED,
  assertDocumentSeedConsistent,
} from "./document-master";

describe("document-master seed data", () => {
  test("passes its own consistency assertions", () => {
    expect(() => assertDocumentSeedConsistent()).not.toThrow();
  });

  test("seeds the full DOC-000…020 range (21 documents), bilingual", () => {
    expect(DOCUMENT_MASTER_SEED).toHaveLength(21);
    for (let i = 0; i <= 20; i++) {
      const no = `DOC-${String(i).padStart(3, "0")}`;
      const doc = DOCUMENT_MASTER_SEED.find((d) => d.no === no);
      expect(doc, `expected ${no}`).toBeDefined();
      expect(doc?.nameId.trim().length).toBeGreaterThan(0);
      expect(doc?.nameEn.trim().length).toBeGreaterThan(0);
    }
  });

  test("every document has a valid appliesTo and non-negative validity", () => {
    for (const d of DOCUMENT_MASTER_SEED) {
      expect(["local", "foreign", "both"]).toContain(d.appliesTo);
      expect(d.validityDays).toBeGreaterThanOrEqual(0);
      expect(Number.isInteger(d.validityDays)).toBe(true);
    }
  });

  test("document `no` is unique", () => {
    const nos = DOCUMENT_MASTER_SEED.map((d) => d.no);
    expect(new Set(nos).size).toBe(nos.length);
  });

  test("every category requirement references a seeded document `no`", () => {
    const nos = new Set(DOCUMENT_MASTER_SEED.map((d) => d.no));
    for (const r of CATEGORY_REQUIREMENT_SEED) {
      expect(nos.has(r.docNo), `requirement doc ${r.docNo}`).toBe(true);
      expect(r.categoryNameEn.trim().length).toBeGreaterThan(0);
    }
  });

  test("wires the category-type licenses so a category's required set exceeds origin", () => {
    // ADR-0013: the required set is origin ∪ category — so at least one Category-type license must be
    // wired to a category to make the gate demonstrable. DOC-014 (fuel) + DOC-015 (distributor).
    const wiredDocs = new Set(CATEGORY_REQUIREMENT_SEED.map((r) => r.docNo));
    expect(wiredDocs.has("DOC-014")).toBe(true);
    expect(wiredDocs.has("DOC-015")).toBe(true);
  });
});
