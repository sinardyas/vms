/**
 * Vendor bank-block schema + invariants (M3.2, #43). Run with `bun test`.
 *
 * Covers the structural schema (caps, required fields, ≥1 currency), the pure invariant predicates
 * (holder-proof, bank-country remark, primary count), and the submit-gate block schema that layers the
 * set-level "exactly one primary" + per-account "holder ≠ company ⇒ KTP + surat" rules on top.
 */

import { describe, expect, test } from "bun:test";
import {
  bankCountryRemarkRequired,
  holderProofIncomplete,
  holderProofRequired,
  missingHolderProof,
  primaryCount,
  vendorBankBlockSchema,
  vendorBankInput,
} from "./vendor-bank";

const U = (n: number) =>
  `${n}${n}${n}${n}${n}${n}${n}${n}-${n}${n}${n}${n}-4${n}${n}${n}-8${n}${n}${n}-${n}${n}${n}${n}${n}${n}${n}${n}${n}${n}${n}${n}`;
const CUR = U(1);
const KTP = U(2);
const SURAT = U(3);
const ID_COUNTRY = U(4);
const SG_COUNTRY = U(5);

const base = {
  bankName: "Bank Mandiri",
  accountNo: "1234567890",
  holderName: "PT Contoh Jaya",
  currencyIds: [CUR],
  holderSameAsCompany: true,
} as const;

describe("vendorBankInput — structural shape", () => {
  test("accepts a minimal well-formed account", () => {
    expect(vendorBankInput.safeParse(base).success).toBe(true);
  });
  test("requires at least one currency", () => {
    expect(vendorBankInput.safeParse({ ...base, currencyIds: [] }).success).toBe(false);
  });
  test("rejects a blank required field", () => {
    expect(vendorBankInput.safeParse({ ...base, accountNo: "" }).success).toBe(false);
  });
  test("rejects an over-long account number", () => {
    expect(vendorBankInput.safeParse({ ...base, accountNo: "x".repeat(61) }).success).toBe(false);
  });
  test("rejects a non-uuid currency id", () => {
    expect(vendorBankInput.safeParse({ ...base, currencyIds: ["nope"] }).success).toBe(false);
  });
});

describe("holder-proof predicates", () => {
  test("no proof required when holder is the company", () => {
    expect(holderProofRequired(base)).toBe(false);
    expect(missingHolderProof(base)).toEqual({ ktp: false, surat: false });
    expect(holderProofIncomplete(base)).toBe(false);
  });
  test("both KTP + surat required when holder ≠ company and neither is present", () => {
    const b = { ...base, holderSameAsCompany: false };
    expect(holderProofRequired(b)).toBe(true);
    expect(missingHolderProof(b)).toEqual({ ktp: true, surat: true });
    expect(holderProofIncomplete(b)).toBe(true);
  });
  test("complete once both files are attached", () => {
    const b = { ...base, holderSameAsCompany: false, ktpFileId: KTP, suratPernyataanFileId: SURAT };
    expect(missingHolderProof(b)).toEqual({ ktp: false, surat: false });
    expect(holderProofIncomplete(b)).toBe(false);
  });
  test("still incomplete when only one of the two is attached", () => {
    const b = { ...base, holderSameAsCompany: false, ktpFileId: KTP };
    expect(missingHolderProof(b)).toEqual({ ktp: false, surat: true });
    expect(holderProofIncomplete(b)).toBe(true);
  });
});

describe("bankCountryRemarkRequired", () => {
  test("required only when both countries are known and differ", () => {
    expect(bankCountryRemarkRequired(SG_COUNTRY, ID_COUNTRY)).toBe(true);
    expect(bankCountryRemarkRequired(ID_COUNTRY, ID_COUNTRY)).toBe(false);
    expect(bankCountryRemarkRequired(undefined, ID_COUNTRY)).toBe(false);
    expect(bankCountryRemarkRequired(SG_COUNTRY, undefined)).toBe(false);
  });
});

describe("primaryCount + vendorBankBlockSchema", () => {
  test("counts primary-flagged accounts", () => {
    expect(primaryCount([{ isPrimary: true }, { isPrimary: false }, {}])).toBe(1);
  });
  test("empty block is valid (origin-level 'must have a bank' is the gate's rule)", () => {
    expect(vendorBankBlockSchema.safeParse([]).success).toBe(true);
  });
  test("valid one-primary block passes", () => {
    const block = [
      { ...base, isPrimary: true },
      { ...base, accountNo: "999", isPrimary: false },
    ];
    expect(vendorBankBlockSchema.safeParse(block).success).toBe(true);
  });
  test("zero primaries is rejected", () => {
    const block = [{ ...base, isPrimary: false }];
    expect(vendorBankBlockSchema.safeParse(block).success).toBe(false);
  });
  test("two primaries is rejected", () => {
    const block = [
      { ...base, isPrimary: true },
      { ...base, accountNo: "999", isPrimary: true },
    ];
    expect(vendorBankBlockSchema.safeParse(block).success).toBe(false);
  });
  test("holder ≠ company without KTP/surat is rejected at the block level", () => {
    const block = [{ ...base, isPrimary: true, holderSameAsCompany: false }];
    const res = vendorBankBlockSchema.safeParse(block);
    expect(res.success).toBe(false);
    if (!res.success) {
      const paths = res.error.issues.map((i) => i.path.join("."));
      expect(paths).toContain("0.ktpFileId");
      expect(paths).toContain("0.suratPernyataanFileId");
    }
  });
  test("holder ≠ company with both files passes", () => {
    const block = [
      {
        ...base,
        isPrimary: true,
        holderSameAsCompany: false,
        ktpFileId: KTP,
        suratPernyataanFileId: SURAT,
      },
    ];
    expect(vendorBankBlockSchema.safeParse(block).success).toBe(true);
  });
});
