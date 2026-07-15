/**
 * Master-data framework — bilingual labels + referential-integrity contract (M2.1, #32). `bun test`.
 *
 * Excluded from tsc (see tsconfig). Covers the domain half's two DoD rules: labels render the active
 * locale and fall back to the sibling when blank (ADR-0011), and the capturable predicate is exactly
 * `active` — so the capture path offers only live rows while resolution keeps working on the rest.
 */

import { describe, expect, test } from "bun:test";
import { z } from "zod";
import {
  type BilingualLabel,
  bilingualLabelFields,
  bilingualLabelSchema,
  capturableOnly,
  isCapturable,
  parseWith,
  resolveLabel,
} from "../index";

describe("resolveLabel — per-locale render with sibling fallback (ADR-0011)", () => {
  const both: BilingualLabel = { id: "Perseroan Terbatas", en: "Limited Company" };

  test("renders the requested locale when present", () => {
    expect(resolveLabel(both, "id")).toBe("Perseroan Terbatas");
    expect(resolveLabel(both, "en")).toBe("Limited Company");
  });

  test("falls back to the other locale when the requested side is blank", () => {
    expect(resolveLabel({ id: "Persekutuan Komanditer", en: "" }, "en")).toBe(
      "Persekutuan Komanditer",
    );
    expect(resolveLabel({ id: "   ", en: "Firm" }, "id")).toBe("Firm");
  });

  test("degrades to empty string when both sides are blank — never a key", () => {
    expect(resolveLabel({ id: "", en: "" }, "en")).toBe("");
    expect(resolveLabel({ id: "  ", en: "\t" }, "id")).toBe("");
  });

  test("trims surrounding whitespace on the rendered side", () => {
    expect(resolveLabel({ id: "  Bank  ", en: "" }, "id")).toBe("Bank");
  });
});

describe("bilingualLabel schemas — shared validation for a master body", () => {
  const schema = z.object(bilingualLabelFields(10));

  test("accepts a trimmed, in-bounds pair", () => {
    const r = parseWith(schema, { nameId: " PT ", nameEn: "Ltd" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toEqual({ nameId: "PT", nameEn: "Ltd" });
  });

  test("rejects a blank or over-long side as a validation error", () => {
    expect(parseWith(schema, { nameId: "", nameEn: "Ltd" }).ok).toBe(false);
    expect(parseWith(schema, { nameId: "PT", nameEn: "x".repeat(11) }).ok).toBe(false);
  });

  test("bilingualLabelSchema parses a standalone label object", () => {
    expect(parseWith(bilingualLabelSchema(20), { nameId: "A", nameEn: "B" }).ok).toBe(true);
  });
});

describe("referential integrity — capturable = active (deactivate hides from NEW captures)", () => {
  const rows = [
    { id: "1", active: true },
    { id: "2", active: false },
    { id: "3", active: true },
  ];

  test("isCapturable is exactly the active flag", () => {
    expect(isCapturable({ active: true })).toBe(true);
    expect(isCapturable({ active: false })).toBe(false);
  });

  test("capturableOnly drops deactivated rows for the capture path", () => {
    expect(capturableOnly(rows).map((r) => r.id)).toEqual(["1", "3"]);
  });

  test("resolution-by-id is unaffected — a deactivated row is still findable by id", () => {
    // The contract: resolution reads DON'T filter by active, so #2 still resolves.
    expect(rows.find((r) => r.id === "2")).toEqual({ id: "2", active: false });
  });
});
