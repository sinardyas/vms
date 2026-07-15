/**
 * Console → Document-master API client (M2.3, #34).
 *
 * Typed wrappers over `/console/document-master/*`: the document list is the same M2.1 master CRUD
 * surface (#32) the registration lists use, so its verbs mirror that client; the category-requirements
 * matrix (`/requirements`) adds three bespoke verbs (list / set / clear a cell). Every call sends the
 * better-auth session cookie (`credentials: "include"`) + the active locale (`?lang`) so a guard
 * refusal (401/403) or a conflict (409) comes back already localized; non-2xx throws a
 * {@link DocMasterApiError} carrying the server's `messageKey`. DTO shapes mirror `apps/api`'s
 * `document-master-route` (the console can't import across the app boundary).
 */

import type { DocAppliesTo } from "@vms/domain";
import { apiUrl } from "./api";

/** A document-master row — the compliance doc type shown in the list + dialog. */
export type DocumentRow = {
  id: string;
  active: boolean;
  no: string;
  nameId: string;
  nameEn: string;
  type: string;
  appliesTo: DocAppliesTo;
  validityDays: number;
  mandatory: boolean;
  reminder: string;
};

/** A requirement cell — a (category, document) pair the activation gate reads, with its mandatory flag. */
export type RequirementRow = {
  id: string;
  categoryId: string;
  documentMasterId: string;
  mandatory: boolean;
};

/** A non-2xx response, carrying the server's localized message + machine key (e.g. a 409 conflict). */
export class DocMasterApiError extends Error {
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

const request = async <T>(path: string, locale: string, init?: RequestInit): Promise<T> => {
  const sep = path.includes("?") ? "&" : "?";
  const res = await fetch(apiUrl(`/console/document-master${path}${sep}lang=${locale}`), {
    credentials: "include",
    headers: init?.body ? { "content-type": "application/json" } : undefined,
    ...init,
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
    throw new DocMasterApiError(
      res.status,
      e.code ?? "internal",
      e.messageKey ?? "error.internal",
      e.message ?? `HTTP ${res.status}`,
      e.params,
    );
  }
  return (await res.json()) as T;
};

/* ── document list (M2.1 master CRUD surface) ─────────────────────────────────── */

export const listDocuments = (locale: string): Promise<DocumentRow[]> =>
  request<{ items: DocumentRow[] }>("", locale).then((r) => r.items);

export const createDocument = (
  locale: string,
  body: Record<string, unknown>,
): Promise<DocumentRow> =>
  request<{ item: DocumentRow }>("", locale, { method: "POST", body: JSON.stringify(body) }).then(
    (r) => r.item,
  );

export const updateDocument = (
  locale: string,
  id: string,
  body: Record<string, unknown>,
): Promise<DocumentRow> =>
  request<{ item: DocumentRow }>(`/${id}`, locale, {
    method: "PATCH",
    body: JSON.stringify(body),
  }).then((r) => r.item);

export const deactivateDocument = (locale: string, id: string): Promise<DocumentRow> =>
  request<{ item: DocumentRow }>(`/${id}`, locale, { method: "DELETE" }).then((r) => r.item);

export const reactivateDocument = (locale: string, id: string): Promise<DocumentRow> =>
  request<{ item: DocumentRow }>(`/${id}/reactivate`, locale, { method: "POST" }).then(
    (r) => r.item,
  );

/* ── category-requirements matrix ─────────────────────────────────────────────── */

export const listRequirements = (locale: string): Promise<RequirementRow[]> =>
  request<{ items: RequirementRow[] }>("/requirements", locale).then((r) => r.items);

/** Set (create-or-update) a requirement cell: category × document, with its mandatory flag. */
export const setRequirement = (
  locale: string,
  categoryId: string,
  documentMasterId: string,
  mandatory: boolean,
): Promise<RequirementRow> =>
  request<{ item: RequirementRow }>("/requirements", locale, {
    method: "PUT",
    body: JSON.stringify({ categoryId, documentMasterId, mandatory }),
  }).then((r) => r.item);

/** Clear a requirement cell (soft-delete). Resolves even if the cell wasn't a requirement (404 → throw). */
export const clearRequirement = (
  locale: string,
  categoryId: string,
  documentMasterId: string,
): Promise<RequirementRow> =>
  request<{ item: RequirementRow }>(`/requirements/${categoryId}/${documentMasterId}`, locale, {
    method: "DELETE",
  }).then((r) => r.item);
