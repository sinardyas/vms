/**
 * Compliance-document verification schemas + decidability predicate (M5.1, #68). Run with `bun test`.
 *
 * Covers the verify-dates input (both optional, expiry-not-before-issue refine), the reject-reason input
 * (required, trimmed, capped), and the pure `isVersionDecidable` guard (only a `pending` version may be
 * verified or rejected — a decided version is terminal).
 */

import { describe, expect, test } from "bun:test";
import {
  isVersionDecidable,
  rejectDocumentInput,
  verifyDocumentInput,
} from "./document-verification";

describe("verifyDocumentInput", () => {
  test("accepts empty dates (perpetual docs)", () => {
    expect(verifyDocumentInput.safeParse({}).success).toBe(true);
  });

  test("accepts issue + expiry in order", () => {
    const r = verifyDocumentInput.safeParse({ issuedOn: "2026-01-01", expiresOn: "2027-01-01" });
    expect(r.success).toBe(true);
  });

  test("accepts equal issue + expiry", () => {
    expect(
      verifyDocumentInput.safeParse({ issuedOn: "2026-01-01", expiresOn: "2026-01-01" }).success,
    ).toBe(true);
  });

  test("rejects expiry before issue", () => {
    const r = verifyDocumentInput.safeParse({ issuedOn: "2027-01-01", expiresOn: "2026-01-01" });
    expect(r.success).toBe(false);
  });

  test("rejects a non-ISO date", () => {
    expect(verifyDocumentInput.safeParse({ issuedOn: "01/01/2026" }).success).toBe(false);
  });

  test("allows expiry alone (no issue date to compare)", () => {
    expect(verifyDocumentInput.safeParse({ expiresOn: "2027-01-01" }).success).toBe(true);
  });
});

describe("rejectDocumentInput", () => {
  test("requires a non-empty reason", () => {
    expect(rejectDocumentInput.safeParse({ reason: "" }).success).toBe(false);
    expect(rejectDocumentInput.safeParse({}).success).toBe(false);
  });

  test("trims and accepts a reason", () => {
    const r = rejectDocumentInput.safeParse({ reason: "  blurry scan  " });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.reason).toBe("blurry scan");
  });

  test("caps the reason length", () => {
    expect(rejectDocumentInput.safeParse({ reason: "x".repeat(1001) }).success).toBe(false);
  });
});

describe("isVersionDecidable", () => {
  test("only a pending version is decidable", () => {
    expect(isVersionDecidable("pending")).toBe(true);
    expect(isVersionDecidable("verified")).toBe(false);
    expect(isVersionDecidable("rejected")).toBe(false);
  });
});
