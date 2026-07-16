/**
 * Vendor profile block + per-origin required set (M3.4, #45). Run with `bun test`.
 *
 * Covers the lenient Draft shape (partial saves validate), the declarative per-origin required-field
 * spec, the presence predicate, and the strict submit schema that turns missing required fields into
 * pathed Zod issues (ADR-0004).
 */

import { describe, expect, test } from "bun:test";
import {
  VENDOR_SUBMIT_REQUIRED,
  isFieldPresent,
  missingProfileFields,
  vendorDraftInput,
  vendorSubmitSchema,
} from "./vendor";

const U = (n: number) => `${"0".repeat(7)}${n}-0000-4000-8000-000000000000`.slice(-36);
const BIZ = U(1);
const CAT = U(2);
const COUNTRY = U(3);

/** A local vendor profile with every submit-required field present. */
const completeLocal = {
  origin: "local" as const,
  source: "self" as const,
  name: "PT Samudera Bahari",
  businessEntityId: BIZ,
  categoryId: CAT,
  taxId: "01.234.567.8-901.000",
  taxStatus: "pkp_corporate" as const,
  npwpType: "head_office" as const,
  companyScale: "menengah" as const,
  address: "Jl. Pelabuhan No. 1",
  city: "Jakarta Utara",
  countryId: COUNTRY,
  phone: "+62215550100",
  picName: "Andi Wijaya",
  picPhone: "+628125550100",
  picEmail: "andi@samuderabahari.co.id",
  paymentTerm: "credit_30" as const,
};

describe("vendorDraftInput — lenient Draft shape", () => {
  test("accepts a barely-started Draft (origin + source + name only)", () => {
    const r = vendorDraftInput.safeParse({ origin: "local", source: "self", name: "PT X" });
    expect(r.success).toBe(true);
  });

  test("rejects a Draft with no name (can't exist without one)", () => {
    expect(vendorDraftInput.safeParse({ origin: "local", source: "self" }).success).toBe(false);
  });

  test("rejects a bad origin / source enum", () => {
    expect(
      vendorDraftInput.safeParse({ origin: "martian", source: "self", name: "X" }).success,
    ).toBe(false);
    expect(
      vendorDraftInput.safeParse({ origin: "local", source: "walk-in", name: "X" }).success,
    ).toBe(false);
  });

  test("caps name at 240 and lower-cases an email", () => {
    expect(
      vendorDraftInput.safeParse({
        origin: "local",
        source: "self",
        name: "x".repeat(241),
      }).success,
    ).toBe(false);
    const r = vendorDraftInput.parse({
      origin: "local",
      source: "self",
      name: "X",
      picEmail: "PIC@Example.COM",
    });
    expect(r.picEmail).toBe("pic@example.com");
  });

  test("rejects a non-uuid businessEntityId", () => {
    expect(
      vendorDraftInput.safeParse({ origin: "local", source: "self", name: "X", categoryId: "nope" })
        .success,
    ).toBe(false);
  });
});

describe("isFieldPresent", () => {
  test("null / undefined / blank strings are absent", () => {
    expect(isFieldPresent(undefined)).toBe(false);
    expect(isFieldPresent(null)).toBe(false);
    expect(isFieldPresent("")).toBe(false);
    expect(isFieldPresent("   ")).toBe(false);
  });
  test("real values are present", () => {
    expect(isFieldPresent("x")).toBe(true);
    expect(isFieldPresent(0)).toBe(true);
    expect(isFieldPresent(false)).toBe(true);
  });
});

describe("per-origin required set", () => {
  test("local requires the Indonesian tax identity, foreign does not", () => {
    for (const f of ["taxId", "taxStatus", "npwpType", "companyScale"] as const) {
      expect(VENDOR_SUBMIT_REQUIRED.local).toContain(f);
      expect(VENDOR_SUBMIT_REQUIRED.foreign).not.toContain(f);
    }
  });

  test("both origins share the common contact + address + payment fields", () => {
    for (const f of [
      "businessEntityId",
      "categoryId",
      "countryId",
      "picEmail",
      "paymentTerm",
    ] as const) {
      expect(VENDOR_SUBMIT_REQUIRED.local).toContain(f);
      expect(VENDOR_SUBMIT_REQUIRED.foreign).toContain(f);
    }
  });

  test("missingProfileFields returns [] when a complete local profile is passed", () => {
    expect(missingProfileFields("local", completeLocal)).toEqual([]);
  });

  test("a complete local profile is still missing nothing as a foreign vendor", () => {
    expect(missingProfileFields("foreign", completeLocal)).toEqual([]);
  });

  test("names each gap, treating null / blank as missing", () => {
    const partial = { ...completeLocal, taxStatus: null, phone: "  ", picEmail: undefined };
    const missing = missingProfileFields("local", partial);
    expect(missing).toContain("taxStatus");
    expect(missing).toContain("phone");
    expect(missing).toContain("picEmail");
    expect(missing).not.toContain("taxId");
  });

  test("a foreign vendor with no tax identity is complete", () => {
    const foreign = {
      origin: "foreign" as const,
      source: "office" as const,
      name: "Global Marine Pte Ltd",
      businessEntityId: BIZ,
      categoryId: CAT,
      address: "1 Marina Blvd",
      city: "Singapore",
      countryId: COUNTRY,
      phone: "+6560000000",
      picName: "Lim",
      picPhone: "+6590000000",
      picEmail: "lim@globalmarine.sg",
      paymentTerm: "credit_45" as const,
    };
    expect(missingProfileFields("foreign", foreign)).toEqual([]);
  });
});

describe("vendorSubmitSchema — strict, origin-driven", () => {
  test("passes a complete local profile", () => {
    expect(vendorSubmitSchema.safeParse(completeLocal).success).toBe(true);
  });

  test("fails and paths each missing required field", () => {
    const r = vendorSubmitSchema.safeParse({ origin: "local", source: "self", name: "PT X" });
    expect(r.success).toBe(false);
    if (r.success) return;
    const paths = r.error.issues.map((i) => i.path.join("."));
    expect(paths).toContain("taxId");
    expect(paths).toContain("categoryId");
    expect(paths).toContain("paymentTerm");
  });

  test("a foreign Draft with the common set but no NPWP passes", () => {
    const foreign = {
      origin: "foreign" as const,
      source: "self" as const,
      name: "Global Marine Pte Ltd",
      businessEntityId: BIZ,
      categoryId: CAT,
      address: "1 Marina Blvd",
      city: "Singapore",
      countryId: COUNTRY,
      phone: "+6560000000",
      picName: "Lim",
      picPhone: "+6590000000",
      picEmail: "lim@globalmarine.sg",
      paymentTerm: "credit_45" as const,
    };
    expect(vendorSubmitSchema.safeParse(foreign).success).toBe(true);
  });
});
