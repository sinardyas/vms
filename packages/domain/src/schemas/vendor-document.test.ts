/**
 * Vendor compliance-document block — schema + capture-completeness predicate (M3.3, #44). Run with
 * `bun test`.
 *
 * Covers the structural version-capture schema (documentMasterId required, optional refNo/variant caps,
 * and that issue/expiry/verify fields are NOT accepted at capture), plus the pure completeness predicate
 * the M3.4 submit gate runs over the origin ∪ category required set (ADR-0013).
 */

import { describe, expect, test } from "bun:test";
import {
  type CapturedDocument,
  documentCaptured,
  documentsComplete,
  missingRequiredDocuments,
  vendorDocumentVersionInput,
} from "./vendor-document";

const U = (n: number) => `${"0".repeat(7)}${n}-0000-4000-8000-000000000000`.slice(-36);
const DOC_A = U(1);
const DOC_B = U(2);
const DOC_C = U(3);

describe("vendorDocumentVersionInput — capture shape", () => {
  test("accepts a bare documentMasterId (refNo/variant optional)", () => {
    const r = vendorDocumentVersionInput.safeParse({ documentMasterId: DOC_A });
    expect(r.success).toBe(true);
  });
  test("accepts refNo + variant", () => {
    const r = vendorDocumentVersionInput.safeParse({
      documentMasterId: DOC_A,
      refNo: "NIB-123",
      variant: "Pendirian",
    });
    expect(r.success).toBe(true);
  });
  test("rejects a missing documentMasterId", () => {
    expect(vendorDocumentVersionInput.safeParse({ refNo: "X" }).success).toBe(false);
  });
  test("rejects a non-uuid documentMasterId", () => {
    expect(vendorDocumentVersionInput.safeParse({ documentMasterId: "nope" }).success).toBe(false);
  });
  test("caps refNo at 120 chars", () => {
    const r = vendorDocumentVersionInput.safeParse({
      documentMasterId: DOC_A,
      refNo: "x".repeat(121),
    });
    expect(r.success).toBe(false);
  });
  test("strips unknown capture fields (issue/expiry entered at verify, not here)", () => {
    const r = vendorDocumentVersionInput.parse({
      documentMasterId: DOC_A,
      issuedOn: "2026-01-01",
      expiresOn: "2027-01-01",
      verifyStatus: "verified",
    });
    expect(r).toEqual({ documentMasterId: DOC_A });
  });
});

describe("completeness predicate — feeds the M3.4 submit gate", () => {
  const captured = (id: string, hasCurrentVersion: boolean): CapturedDocument => ({
    documentMasterId: id,
    hasCurrentVersion,
  });

  test("documentCaptured reflects the current-version flag", () => {
    expect(documentCaptured(captured(DOC_A, true))).toBe(true);
    expect(documentCaptured(captured(DOC_A, false))).toBe(false);
  });

  test("missing = required ids without an uploaded version", () => {
    const missing = missingRequiredDocuments(
      [DOC_A, DOC_B, DOC_C],
      [captured(DOC_A, true), captured(DOC_B, false)],
    );
    expect(missing).toEqual([DOC_B, DOC_C]);
  });

  test("a slot with no current version does not satisfy its requirement", () => {
    expect(missingRequiredDocuments([DOC_A], [captured(DOC_A, false)])).toEqual([DOC_A]);
  });

  test("duplicate required ids are collapsed", () => {
    expect(missingRequiredDocuments([DOC_A, DOC_A], [])).toEqual([DOC_A]);
  });

  test("complete only when every required doc has a version", () => {
    expect(documentsComplete([DOC_A, DOC_B], [captured(DOC_A, true), captured(DOC_B, true)])).toBe(
      true,
    );
    expect(documentsComplete([DOC_A, DOC_B], [captured(DOC_A, true)])).toBe(false);
    expect(documentsComplete([], [])).toBe(true);
  });
});
