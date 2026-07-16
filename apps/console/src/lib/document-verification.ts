/**
 * Console → document-verification API client (M5.4, #71).
 *
 * Typed wrappers over `/console/document-verification` (M5.1, #68) — the verifier's queue of
 * still-pending document versions on vendors under review, a `documents`-gated **signed URL** to view a
 * document before deciding (reuses the M3.3 presign), and the two decisions: **verify** (entering/
 * confirming the certificate's issue/expiry dates) and **reject** (required reason). Rejecting a
 * *mandatory* document also bounces the vendor's registration back to Draft (M5.3) — the reject response
 * flags `returnedToDraft` so the console can say so.
 *
 * DTO shapes mirror `apps/api` (the console can't import across the app boundary). Every call rides
 * {@link request} (session cookie + `?lang`), so a guard refusal or a 409/404 comes back localized and
 * typed as {@link VendorApiError}.
 */

import { type VendorApiError, request } from "./vendors";

export type { VendorApiError };

/* ── DTOs (mirror the API) ────────────────────────────────────────────────────────────────────── */

/** One document awaiting the verifier's decision — the current version of a slot on a Pending vendor. */
export type VerificationQueueItem = {
  versionId: string;
  slotId: string;
  vendorId: string;
  vendorName: string;
  documentMasterId: string;
  documentNo: string;
  documentNameId: string;
  documentNameEn: string;
  documentMandatory: boolean;
  versionNo: number;
  refNo: string | null;
  variant: string | null;
  uploadedAt: string;
};

/** A version after a verify/reject decision, as returned to the client. */
export type VerifiedVersionDTO = {
  id: string;
  slotId: string;
  versionNo: number;
  verifyStatus: string;
  issuedOn: string | null;
  expiresOn: string | null;
  verifiedBy: string | null;
  verifiedAt: string | null;
  rejectReason: string | null;
};

/** The certificate dates entered/confirmed at verification (both optional; expiry ≥ issue). */
export type VerifyDates = { issuedOn?: string; expiresOn?: string };

/** A reject's outcome — the decided version plus whether it bounced the vendor to Draft (M5.3). */
export type RejectOutcome = { item: VerifiedVersionDTO; returnedToDraft: boolean };

/* ── Client ───────────────────────────────────────────────────────────────────────────────────── */

export const verificationApi = {
  /** The verifier's queue: current, still-pending versions on vendors under review (`?vendorId=` narrows). */
  queue: (locale: string, vendorId?: string): Promise<VerificationQueueItem[]> =>
    request<{ items: VerificationQueueItem[] }>(
      `/console/document-verification${vendorId ? `?vendorId=${vendorId}` : ""}`,
      locale,
    ).then((r) => r.items),

  /** A short-lived signed URL to view one version's file straight from MinIO before deciding. */
  versionUrl: (locale: string, versionId: string): Promise<string> =>
    request<{ url: string }>(
      `/console/document-verification/versions/${versionId}/url`,
      locale,
    ).then((r) => r.url),

  /** Verify a version, entering/confirming its certificate issue/expiry dates. */
  verify: (locale: string, versionId: string, dates: VerifyDates): Promise<VerifiedVersionDTO> =>
    request<{ item: VerifiedVersionDTO }>(
      `/console/document-verification/versions/${versionId}/verify`,
      locale,
      { method: "POST", body: JSON.stringify(dates) },
    ).then((r) => r.item),

  /** Reject a version with a required reason → `{ item, returnedToDraft }` (mandatory-doc bounce, M5.3). */
  reject: (locale: string, versionId: string, reason: string): Promise<RejectOutcome> =>
    request<{ item: VerifiedVersionDTO; returnedToDraft: boolean }>(
      `/console/document-verification/versions/${versionId}/reject`,
      locale,
      { method: "POST", body: JSON.stringify({ reason }) },
    ).then((r) => ({ item: r.item, returnedToDraft: r.returnedToDraft })),
};
