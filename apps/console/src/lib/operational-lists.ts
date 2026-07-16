/**
 * Console → Operational-lists API client (M2.5, #36).
 *
 * Generic typed wrappers over `/console/operational-lists/<list>/*` — one set of verbs (list, create,
 * update, deactivate, reactivate) parameterised by the list's path segment, since every list is the
 * same M2.1 master CRUD surface (#32). Every call sends the better-auth session cookie
 * (`credentials: "include"`) + the active locale (`?lang`) so a guard refusal (401/403) or a conflict
 * (409) comes back already localized; non-2xx throws an {@link OperationalListApiError} carrying the
 * server's `messageKey`. DTO shapes mirror `apps/api`'s `operational-lists-route` (the console can't
 * import across the app boundary), keyed to the domain's `DocAppliesTo`.
 */

import type { DocAppliesTo } from "@vms/domain";
import { apiUrl } from "./api";

/** The minimum every operational-list row exposes; a list narrows this to its own shape below. */
export type MasterRow = { id: string; active: boolean };

export type DepartmentRow = MasterRow & { code: string; nameId: string; nameEn: string };
export type SoechiEntityRow = MasterRow & { nameId: string; nameEn: string };
export type VesselRow = MasterRow & { code: string; name: string; type: string | null };
export type PortRow = MasterRow & {
  code: string;
  name: string;
  countryId: string | null;
  tz: string | null;
  lat: string | null;
  lon: string | null;
};
export type TaxCodeRow = MasterRow & {
  code: string;
  labelId: string;
  labelEn: string;
  rate: string | null;
  basis: string | null;
  appliesTo: DocAppliesTo;
};
export type SlaThresholdRow = MasterRow & {
  stageId: string;
  stageEn: string;
  target: string | null;
  warnAt: string | null;
  email: boolean;
};

/** A non-2xx response, carrying the server's localized message + machine key (e.g. a 409 conflict). */
export class OperationalListApiError extends Error {
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

const request = async <T>(
  listPath: string,
  path: string,
  locale: string,
  init?: RequestInit,
): Promise<T> => {
  const sep = path.includes("?") ? "&" : "?";
  const res = await fetch(
    apiUrl(`/console/operational-lists/${listPath}${path}${sep}lang=${locale}`),
    {
      credentials: "include",
      headers: init?.body ? { "content-type": "application/json" } : undefined,
      ...init,
    },
  );
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
    throw new OperationalListApiError(
      res.status,
      e.code ?? "internal",
      e.messageKey ?? "error.internal",
      e.message ?? `HTTP ${res.status}`,
      e.params,
    );
  }
  return (await res.json()) as T;
};

/** List every row (the console view). Pass `activeOnly` to get only capturable rows (the capture path). */
export const listItems = <T extends MasterRow>(
  listPath: string,
  locale: string,
  activeOnly = false,
): Promise<T[]> =>
  request<{ items: T[] }>(listPath, activeOnly ? "?active=true" : "", locale).then((r) => r.items);

export const createItem = <T extends MasterRow>(
  listPath: string,
  locale: string,
  body: Record<string, unknown>,
): Promise<T> =>
  request<{ item: T }>(listPath, "", locale, { method: "POST", body: JSON.stringify(body) }).then(
    (r) => r.item,
  );

export const updateItem = <T extends MasterRow>(
  listPath: string,
  locale: string,
  id: string,
  body: Record<string, unknown>,
): Promise<T> =>
  request<{ item: T }>(listPath, `/${id}`, locale, {
    method: "PATCH",
    body: JSON.stringify(body),
  }).then((r) => r.item);

export const deactivateItem = <T extends MasterRow>(
  listPath: string,
  locale: string,
  id: string,
): Promise<T> =>
  request<{ item: T }>(listPath, `/${id}`, locale, { method: "DELETE" }).then((r) => r.item);

export const reactivateItem = <T extends MasterRow>(
  listPath: string,
  locale: string,
  id: string,
): Promise<T> =>
  request<{ item: T }>(listPath, `/${id}/reactivate`, locale, { method: "POST" }).then(
    (r) => r.item,
  );
