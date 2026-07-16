/**
 * Console → office vendor-registration API client (M3.6, #47).
 *
 * Typed wrappers over the vendor aggregate (M3.5), its bank block (M3.2), its document capture (M3.3),
 * and the registration-list masters (M2.2) the form reads its dropdowns from — the *same* endpoints the
 * portal drives, reached here by an internal staff actor. The server keys the audience off the actor
 * `kind`: a `POST /vendors` from staff creates a `source=office` Draft (no owner link), and its submit
 * routes to `pending_hod` (ADR-0009). DTO shapes mirror `apps/api` (the console can't import across the
 * app boundary). Every call rides {@link request} (session cookie + `?lang`), so a guard refusal, a 422
 * gate failure, or the 409 tax-id conflict all come back localized and typed as {@link VendorApiError}.
 */

import { apiUrl } from "./api";

/** A non-2xx response, carrying the server's localized message + machine key/params. */
export class VendorApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly messageKey: string,
    override readonly message: string,
    readonly params?: Record<string, string | number>,
  ) {
    super(message);
  }
}

/**
 * Fetch `path` with the session cookie + active locale, returning the parsed JSON. A string body is
 * sent as JSON; a `FormData` body is left untouched so its multipart boundary survives (file uploads).
 * Non-2xx throws a {@link VendorApiError} built from the server's `error`.
 */
export async function request<T>(path: string, locale: string, init?: RequestInit): Promise<T> {
  const sep = path.includes("?") ? "&" : "?";
  const isJsonBody = typeof init?.body === "string";
  const res = await fetch(apiUrl(`${path}${sep}lang=${locale}`), {
    credentials: "include",
    ...init,
    headers: {
      ...(isJsonBody ? { "content-type": "application/json" } : {}),
      ...init?.headers,
    },
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as {
      error?: {
        code?: string;
        messageKey?: string;
        message?: string;
        params?: Record<string, string | number>;
      };
    };
    const e = body.error ?? {};
    throw new VendorApiError(
      res.status,
      e.code ?? "internal",
      e.messageKey ?? "error.internal",
      e.message ?? `HTTP ${res.status}`,
      e.params,
    );
  }
  return (await res.json()) as T;
}

/* ── Vendor aggregate ─────────────────────────────────────────────────────────────────────────── */

/** The vendor record as the console reads it (mirrors the API `VendorDTO`). Nullable = not-yet-filled. */
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

/** The Draft payload a screen saves — the lenient shape (only origin/name are truly required). */
export type VendorDraftPayload = {
  origin: "local" | "foreign";
  name: string;
  [field: string]: string | number | undefined;
};

/** A vendor as the browse list renders it (mirrors the API `VendorSummaryDTO`, M3.7). */
export type VendorSummaryDTO = {
  id: string;
  name: string;
  origin: "local" | "foreign";
  status: string;
  source: string;
  taxId: string | null;
  categoryId: string | null;
  countryId: string | null;
  changePending: boolean;
};

/** One mandatory document the vendor must supply, as the doc section renders it. */
export type RequiredDocumentDTO = {
  documentMasterId: string;
  no: string;
  nameId: string;
  nameEn: string;
  captured: boolean;
};

export const vendorApi = {
  /** Every vendor as a browse-list summary (M3.7) — newest first, staff-scoped by the server. */
  list: (locale: string): Promise<VendorSummaryDTO[]> =>
    request<{ items: VendorSummaryDTO[] }>("/vendors", locale).then((r) => r.items),

  /** One vendor's full record (M3.7 profile Details tab), or throws a {@link VendorApiError}. */
  get: (locale: string, id: string): Promise<VendorDTO> =>
    request<{ item: VendorDTO }>(`/vendors/${id}`, locale).then((r) => r.item),

  // No `source` in the body: the server sets `office` from the (internal) actor kind. Sending one would
  // be ignored, so we omit it to make the "server decides the audience" contract explicit.
  create: (
    locale: string,
    body: { origin: "local" | "foreign"; name: string },
  ): Promise<VendorDTO> =>
    request<{ item: VendorDTO }>("/vendors", locale, {
      method: "POST",
      body: JSON.stringify({ ...body, source: "office" }),
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

  remove: (locale: string, vid: string, bankId: string): Promise<BankDTO> =>
    request<{ item: BankDTO }>(`/vendors/${vid}/banks/${bankId}`, locale, {
      method: "DELETE",
    }).then((r) => r.item),

  /** Upload one attachment (validated, not gated) → returns the file id to link onto a bank slot. */
  uploadAttachment: (locale: string, vid: string, file: File): Promise<string> => {
    const form = new FormData();
    form.append("file", file);
    return request<{ file: { id: string } }>(`/vendors/${vid}/banks/attachments`, locale, {
      method: "POST",
      body: form,
    }).then((r) => r.file.id);
  },
};

/* ── Document capture (M3.3) ──────────────────────────────────────────────────────────────────── */

/** One uploaded version of a document (the read fields the profile Documents tab shows). */
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
  /** A vendor's captured document slots, each with its current version + history (M3.7 read). */
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

  /** A short-lived signed URL to preview one version's file straight from MinIO. */
  versionUrl: (locale: string, vid: string, versionId: string): Promise<string> =>
    request<{ url: string }>(`/vendors/${vid}/documents/versions/${versionId}/url`, locale).then(
      (r) => r.url,
    ),
};

/* ── Audit trail (M1.4, #23) — the profile Activity tab ───────────────────────────────────────── */

/** One audit row as the Activity tab renders it (mirrors the API `AuditRowDTO`). */
export type AuditRowDTO = {
  id: string;
  at: string;
  actorUserId: string | null;
  actorName: string | null;
  actorEmail: string | null;
  action: string;
  module: string | null;
  subjectType: string;
  subjectId: string | null;
  ip: string | null;
};

export const auditApi = {
  /**
   * The audit trail scoped to one vendor (subjectType=vendor, subjectId=vendorId) — the Activity tab.
   * Gated `audit:view` server-side, so the caller must hold it (the tab is hidden otherwise).
   */
  forVendor: (locale: string, vendorId: string, limit = 100): Promise<AuditRowDTO[]> =>
    request<{ rows: AuditRowDTO[] }>(
      `/console/audit?subjectType=vendor&subjectId=${vendorId}&limit=${limit}`,
      locale,
    ).then((r) => r.rows),
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
