/**
 * Vendor Portal → vendor-registration API client (M3.5, #46).
 *
 * Typed wrappers over the vendor aggregate (M3.5), its bank block (M3.2), its document capture (M3.3),
 * and the registration-list masters (M2.2) the form reads its dropdowns from. DTO shapes mirror
 * `apps/api` (the portal can't import across the app boundary) — the same fields the API returns. Every
 * call rides {@link request} (session cookie + `?lang`), so a guard refusal, a 422 gate failure, or the
 * 409 tax-id conflict all come back localized and typed as {@link PortalApiError}.
 */

import { PortalApiError, request } from "./api";

/* ── Vendor aggregate ─────────────────────────────────────────────────────────────────────────── */

/** The vendor record as the portal reads it (mirrors the API `VendorDTO`). Nullable = not-yet-filled. */
export type VendorDTO = {
  id: string;
  origin: "local" | "foreign";
  status: string;
  source: string;
  name: string;
  businessEntityId: string | null;
  categoryId: string | null;
  taxId: string | null;
  taxStatus: string | null;
  npwpType: string | null;
  companyScale: string | null;
  procurementNote: string | null;
  address: string | null;
  city: string | null;
  postal: string | null;
  countryId: string | null;
  phone: string | null;
  fax: string | null;
  yearFounded: number | null;
  website: string | null;
  email: string | null;
  commissioner: string | null;
  director: string | null;
  picName: string | null;
  picRole: string | null;
  picPhone: string | null;
  picEmail: string | null;
  soechiReference: string | null;
  paymentTerm: string | null;
  signedTermsFileId: string | null;
  changePending: boolean;
};

/** The Draft payload a screen saves — the lenient shape (only origin/source/name are truly required). */
export type VendorDraftPayload = {
  origin: "local" | "foreign";
  source: "self";
  name: string;
  [field: string]: string | number | undefined;
};

/** One mandatory document the vendor must supply, as the doc section renders it (portal-scoped). */
export type RequiredDocumentDTO = {
  documentMasterId: string;
  no: string;
  nameId: string;
  nameEn: string;
  captured: boolean;
  /** The verifier's outcome on the current version (M6.3) — `null` when nothing is captured yet. */
  verifyStatus: "pending" | "verified" | "rejected" | null;
  /** Why it was rejected — `null` unless `verifyStatus === "rejected"`. */
  rejectReason: string | null;
};

/**
 * The last decision on the vendor's registration (M6.3, ADR-0016) — what the status view shows when a
 * registration comes back rejected. Read from the record, so it says what is true now rather than
 * what some email said at the time.
 */
export type VendorDecisionDTO = {
  outcome: string;
  reason: string | null;
  decidedByName: string | null;
  decidedAt: string | null;
};

export const vendorApi = {
  /** The caller's own vendor Draft, or `null` when they haven't started one (the resume lookup). */
  getMe: async (locale: string): Promise<VendorDTO | null> => {
    try {
      const { item } = await request<{ item: VendorDTO }>("/vendors/me", locale);
      return item;
    } catch (e) {
      if (e instanceof PortalApiError && e.status === 404) return null;
      throw e;
    }
  },

  create: (
    locale: string,
    body: { origin: "local" | "foreign"; source: "self"; name: string },
  ): Promise<VendorDTO> =>
    request<{ item: VendorDTO }>("/vendors", locale, {
      method: "POST",
      body: JSON.stringify(body),
    }).then((r) => r.item),

  update: (locale: string, id: string, draft: VendorDraftPayload): Promise<VendorDTO> =>
    request<{ item: VendorDTO }>(`/vendors/${id}`, locale, {
      method: "PUT",
      body: JSON.stringify(draft),
    }).then((r) => r.item),

  submit: (locale: string, id: string): Promise<VendorDTO> =>
    request<{ item: VendorDTO }>(`/vendors/${id}/submit`, locale, {
      method: "POST",
      body: JSON.stringify({}),
    }).then((r) => r.item),

  requiredDocuments: (locale: string, id: string): Promise<RequiredDocumentDTO[]> =>
    request<{ items: RequiredDocumentDTO[] }>(`/vendors/${id}/required-documents`, locale).then(
      (r) => r.items,
    ),

  /** The last decision taken on the registration — `null` while nothing has been decided yet. */
  latestDecision: (locale: string, id: string): Promise<VendorDecisionDTO | null> =>
    request<{ item: VendorDecisionDTO | null }>(`/vendors/${id}/latest-decision`, locale).then(
      (r) => r.item,
    ),
};

/* ── Bank block (M3.2) ────────────────────────────────────────────────────────────────────────── */

/** One bank account (the API `VendorBankDTO`) — also the input shape for create/update. */
export type BankDTO = {
  id?: string;
  bankId?: string | null;
  bankName: string;
  accountNo: string;
  holderName: string;
  branch?: string | null;
  description?: string | null;
  swift?: string | null;
  iban?: string | null;
  bankCountryId?: string | null;
  currencyIds: string[];
  isPrimary?: boolean;
  holderSameAsCompany: boolean;
  differsFromCompanyRemark?: string | null;
  proofFileId?: string | null;
  ktpFileId?: string | null;
  suratPernyataanFileId?: string | null;
};

/** The three attachment slots on a bank account. */
export type BankSlot = "proof" | "ktp" | "surat";

/** Strip nulls → the JSON the bank route's Zod expects (optionals absent, not null). */
const bankBody = (input: BankDTO): Record<string, unknown> => {
  const out: Record<string, unknown> = {
    bankName: input.bankName,
    accountNo: input.accountNo,
    holderName: input.holderName,
    currencyIds: input.currencyIds,
    holderSameAsCompany: input.holderSameAsCompany,
  };
  const optional: (keyof BankDTO)[] = [
    "bankId",
    "branch",
    "description",
    "swift",
    "iban",
    "bankCountryId",
    "isPrimary",
    "differsFromCompanyRemark",
    "proofFileId",
    "ktpFileId",
    "suratPernyataanFileId",
  ];
  for (const key of optional) {
    const value = input[key];
    if (value !== null && value !== undefined && value !== "") out[key] = value;
  }
  return out;
};

export const banksApi = {
  list: (locale: string, vid: string): Promise<BankDTO[]> =>
    request<{ items: BankDTO[] }>(`/vendors/${vid}/banks`, locale).then((r) => r.items),

  create: (locale: string, vid: string, input: BankDTO): Promise<BankDTO> =>
    request<{ item: BankDTO }>(`/vendors/${vid}/banks`, locale, {
      method: "POST",
      body: JSON.stringify(bankBody(input)),
    }).then((r) => r.item),

  update: (locale: string, vid: string, bankId: string, input: BankDTO): Promise<BankDTO> =>
    request<{ item: BankDTO }>(`/vendors/${vid}/banks/${bankId}`, locale, {
      method: "PUT",
      body: JSON.stringify(bankBody(input)),
    }).then((r) => r.item),

  remove: (locale: string, vid: string, bankId: string): Promise<BankDTO> =>
    request<{ item: BankDTO }>(`/vendors/${vid}/banks/${bankId}`, locale, {
      method: "DELETE",
    }).then((r) => r.item),

  /** Upload one attachment (validated, not gated) → returns the file id to link onto a bank slot. */
  uploadAttachment: (locale: string, vid: string, file: File): Promise<string> => {
    const form = new FormData();
    form.append("file", file);
    // The route returns { file: StoredFile }, so the id to link onto proof/ktp/surat is `file.id`.
    return request<{ file: { id: string } }>(`/vendors/${vid}/banks/attachments`, locale, {
      method: "POST",
      body: form,
    }).then((r) => r.file.id);
  },

  attachmentUrl: (locale: string, vid: string, bankId: string, slot: BankSlot): Promise<string> =>
    request<{ url: string }>(
      `/vendors/${vid}/banks/${bankId}/attachments/${slot}/url`,
      locale,
    ).then((r) => r.url),
};

/* ── Document capture (M3.3) ──────────────────────────────────────────────────────────────────── */

export type DocumentVersionDTO = {
  id: string;
  versionNo: number;
  fileId: string;
  refNo: string | null;
  variant: string | null;
};

export type DocumentSlotDTO = {
  id: string;
  vendorId: string;
  documentMasterId: string;
  currentVersionId: string | null;
  currentVersion: DocumentVersionDTO | null;
  versions: DocumentVersionDTO[];
};

export const docsApi = {
  list: (locale: string, vid: string): Promise<DocumentSlotDTO[]> =>
    request<{ items: DocumentSlotDTO[] }>(`/vendors/${vid}/documents`, locale).then((r) => r.items),

  uploadVersion: (
    locale: string,
    vid: string,
    input: { file: File; documentMasterId: string; refNo?: string; variant?: string },
  ): Promise<DocumentSlotDTO> => {
    const form = new FormData();
    form.append("file", input.file);
    form.append("documentMasterId", input.documentMasterId);
    if (input.refNo) form.append("refNo", input.refNo);
    if (input.variant) form.append("variant", input.variant);
    return request<{ item: DocumentSlotDTO }>(`/vendors/${vid}/documents/versions`, locale, {
      method: "POST",
      body: form,
    }).then((r) => r.item);
  },

  versionUrl: (locale: string, vid: string, versionId: string): Promise<string> =>
    request<{ url: string }>(`/vendors/${vid}/documents/versions/${versionId}/url`, locale).then(
      (r) => r.url,
    ),
};

/* ── Registration-list masters (M2.2) — the form's dropdowns ──────────────────────────────────── */

export type BilingualRow = { id: string; nameId: string; nameEn: string };
export type CountryRow = { id: string; name: string; iso3: string };
export type CurrencyRow = { id: string; code: string; name: string };

const listMaster = <T>(seg: string, locale: string): Promise<T[]> =>
  request<{ items: T[] }>(`/console/registration-lists/${seg}?active=true`, locale).then(
    (r) => r.items,
  );

export const listsApi = {
  categories: (locale: string): Promise<BilingualRow[]> =>
    listMaster<BilingualRow>("vendor-categories", locale),
  businessEntities: (locale: string): Promise<BilingualRow[]> =>
    listMaster<BilingualRow>("business-entities", locale),
  countries: (locale: string): Promise<CountryRow[]> => listMaster<CountryRow>("countries", locale),
  currencies: (locale: string): Promise<CurrencyRow[]> =>
    listMaster<CurrencyRow>("currencies", locale),
};
