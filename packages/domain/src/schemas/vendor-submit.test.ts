/**
 * Vendor submit gate — whole-aggregate completeness (M3.4, #45). Run with `bun test`.
 *
 * Covers the required-document-set composition from the requirements matrix (origin ∪ category), and
 * the cross-block gate (profile + banks + documents) that both the portal and office API run, incl. its
 * collapse to a typed 422 DomainError (ADR-0004/0005/0007/0013).
 */

import { describe, expect, test } from "bun:test";
import type { VendorBankInput } from "./vendor-bank";
import {
  type VendorSubmissionCandidate,
  checkVendorSubmittable,
  ensureVendorSubmittable,
  requiredDocumentSet,
  submitReadinessError,
} from "./vendor-submit";

const U = (n: number) => `${"0".repeat(7)}${n}-0000-4000-8000-000000000000`.slice(-36);
const BIZ = U(1);
const CAT = U(2);
const COUNTRY = U(3);
const COUNTRY_OTHER = U(4);
const CURRENCY = U(5);
const DOC_ORIGIN = U(10);
const DOC_BOTH = U(11);
const DOC_CATEGORY = U(12);
const DOC_OPTIONAL = U(13);
const DOC_DISABLED = U(14);
const DOC_FOREIGN = U(15);

const completeLocalProfile = {
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

const primaryBank: VendorBankInput = {
  bankName: "Bank Mandiri",
  accountNo: "1234567890",
  holderName: "PT Samudera Bahari",
  currencyIds: [CURRENCY],
  isPrimary: true,
  holderSameAsCompany: true,
};

describe("requiredDocumentSet — origin ∪ category (ADR-0013)", () => {
  const master = [
    { id: DOC_ORIGIN, appliesTo: "local" as const, mandatory: true, enabled: true },
    { id: DOC_BOTH, appliesTo: "both" as const, mandatory: true, enabled: true },
    { id: DOC_FOREIGN, appliesTo: "foreign" as const, mandatory: true, enabled: true },
    { id: DOC_OPTIONAL, appliesTo: "local" as const, mandatory: false, enabled: true },
    { id: DOC_DISABLED, appliesTo: "local" as const, mandatory: true, enabled: false },
  ];
  const categoryRequirements = [
    {
      categoryId: CAT,
      documentMasterId: DOC_CATEGORY,
      mandatory: true,
      active: true,
      enabled: true,
    },
    // a different category's requirement — must not leak in
    { categoryId: U(9), documentMasterId: U(8), mandatory: true, active: true, enabled: true },
  ];

  test("local vendor gets origin(local)+both+its category's docs, not optional/disabled/foreign", () => {
    const set = requiredDocumentSet(
      { origin: "local", categoryId: CAT },
      { master, categoryRequirements },
    );
    expect(new Set(set)).toEqual(new Set([DOC_ORIGIN, DOC_BOTH, DOC_CATEGORY]));
  });

  test("foreign vendor gets foreign+both, not the local-only doc", () => {
    const set = requiredDocumentSet(
      { origin: "foreign", categoryId: CAT },
      { master, categoryRequirements },
    );
    expect(new Set(set)).toEqual(new Set([DOC_FOREIGN, DOC_BOTH, DOC_CATEGORY]));
  });

  test("no category yet ⇒ only origin-level docs", () => {
    const set = requiredDocumentSet(
      { origin: "local", categoryId: null },
      { master, categoryRequirements },
    );
    expect(new Set(set)).toEqual(new Set([DOC_ORIGIN, DOC_BOTH]));
  });

  test("an inactive requirement row is excluded", () => {
    const set = requiredDocumentSet(
      { origin: "local", categoryId: CAT },
      {
        master: [],
        categoryRequirements: [
          {
            categoryId: CAT,
            documentMasterId: DOC_CATEGORY,
            mandatory: true,
            active: false,
            enabled: true,
          },
        ],
      },
    );
    expect(set).toEqual([]);
  });
});

describe("checkVendorSubmittable — the whole-aggregate gate", () => {
  const ready: VendorSubmissionCandidate = {
    profile: completeLocalProfile,
    banks: [primaryBank],
    requiredDocMasterIds: [DOC_ORIGIN],
    capturedDocuments: [{ documentMasterId: DOC_ORIGIN, hasCurrentVersion: true }],
  };

  test("a complete Draft is submittable", () => {
    const r = checkVendorSubmittable(ready);
    expect(r.ok).toBe(true);
    expect(r.issues).toEqual([]);
  });

  test("reports missing profile fields, in the profile section", () => {
    const r = checkVendorSubmittable({
      ...ready,
      profile: { ...completeLocalProfile, taxId: null, picEmail: undefined },
    });
    expect(r.ok).toBe(false);
    const profilePaths = r.issues.filter((i) => i.section === "profile").map((i) => i.path);
    expect(profilePaths).toContain("taxId");
    expect(profilePaths).toContain("picEmail");
  });

  test("requires at least one bank", () => {
    const r = checkVendorSubmittable({ ...ready, banks: [] });
    expect(r.ok).toBe(false);
    expect(r.issues).toContainEqual({ section: "banks", messageKey: "error.vendor.bankRequired" });
  });

  test("requires exactly one primary bank", () => {
    const r = checkVendorSubmittable({
      ...ready,
      banks: [primaryBank, { ...primaryBank, isPrimary: true }],
    });
    expect(r.ok).toBe(false);
    const issue = r.issues.find((i) => i.messageKey === "error.vendor.bankPrimaryOne");
    expect(issue?.params).toEqual({ count: 2 });
  });

  test("flags a holder≠company bank missing its KTP + surat", () => {
    const r = checkVendorSubmittable({
      ...ready,
      banks: [{ ...primaryBank, holderSameAsCompany: false }],
    });
    expect(r.ok).toBe(false);
    expect(r.issues).toContainEqual({
      section: "banks",
      path: "banks[0]",
      messageKey: "error.bank.holderProofRequired",
    });
  });

  test("flags an out-of-country bank missing its remark, using the vendor country", () => {
    const r = checkVendorSubmittable({
      ...ready,
      banks: [{ ...primaryBank, bankCountryId: COUNTRY_OTHER }],
    });
    expect(r.ok).toBe(false);
    expect(r.issues).toContainEqual({
      section: "banks",
      path: "banks[0]",
      messageKey: "error.bank.countryRemarkRequired",
    });
  });

  test("an out-of-country bank WITH a remark passes the remark rule", () => {
    const r = checkVendorSubmittable({
      ...ready,
      banks: [
        { ...primaryBank, bankCountryId: COUNTRY_OTHER, differsFromCompanyRemark: "HQ account" },
      ],
    });
    expect(r.ok).toBe(true);
  });

  test("reports each mandatory doc without a captured version", () => {
    const r = checkVendorSubmittable({
      ...ready,
      requiredDocMasterIds: [DOC_ORIGIN, DOC_CATEGORY],
      capturedDocuments: [{ documentMasterId: DOC_ORIGIN, hasCurrentVersion: true }],
    });
    expect(r.ok).toBe(false);
    expect(r.issues).toContainEqual({
      section: "documents",
      path: DOC_CATEGORY,
      messageKey: "error.vendor.documentMissing",
    });
  });

  test("a slot with no current version does not satisfy its requirement", () => {
    const r = checkVendorSubmittable({
      ...ready,
      capturedDocuments: [{ documentMasterId: DOC_ORIGIN, hasCurrentVersion: false }],
    });
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.section === "documents")).toBe(true);
  });

  test("collects blockers from all three sections at once", () => {
    const r = checkVendorSubmittable({
      profile: { ...completeLocalProfile, taxId: null },
      banks: [],
      requiredDocMasterIds: [DOC_ORIGIN],
      capturedDocuments: [],
    });
    const sections = new Set(r.issues.map((i) => i.section));
    expect(sections).toEqual(new Set(["profile", "banks", "documents"]));
  });
});

describe("ensureVendorSubmittable + submitReadinessError — the API 422 form", () => {
  const ready: VendorSubmissionCandidate = {
    profile: completeLocalProfile,
    banks: [primaryBank],
    requiredDocMasterIds: [],
    capturedDocuments: [],
  };

  test("ok(candidate) when submittable", () => {
    const r = ensureVendorSubmittable(ready);
    expect(r.ok).toBe(true);
  });

  test("err with an invariant DomainError carrying the issues as details", () => {
    const r = ensureVendorSubmittable({ ...ready, banks: [] });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe("invariant");
    expect(r.error.messageKey).toBe("error.vendor.notSubmittable");
    expect(Array.isArray(r.error.details)).toBe(true);
  });

  test("submitReadinessError maps a not-ready verdict to a 422-coded error", () => {
    const readiness = checkVendorSubmittable({ ...ready, banks: [] });
    const error = submitReadinessError(readiness);
    expect(error.code).toBe("invariant");
    expect(error.details).toEqual(readiness.issues);
  });
});
