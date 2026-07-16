/**
 * Console → Approval-routes API client (M2.4, #35).
 *
 * Typed wrappers over `/console/approval-routes/*`: the route header is the same M2.1 master CRUD
 * surface (#32) the other lists use, plus three bespoke verbs for the ordered steps (list / replace /
 * role picker). Every call sends the better-auth session cookie (`credentials: "include"`) + the active
 * locale (`?lang`) so a guard refusal (401/403), a conflict (409), or the deadlock warning (422) comes
 * back already localized; non-2xx throws an {@link ApprovalRouteApiError} carrying the server's
 * `messageKey`. DTO shapes mirror `apps/api`'s `approval-routes-route` (the console can't import across
 * the app boundary).
 */

import type { ApprovalTrigger } from "@vms/domain";
import { apiUrl } from "./api";

/** An approval-route header row — one per trigger. */
export type ApprovalRouteRow = {
  id: string;
  active: boolean;
  trigger: ApprovalTrigger;
  nameId: string;
  nameEn: string;
};

/** One ordered step: its position and the role that decides it (joined for display). */
export type RouteStepRow = {
  id: string;
  routeId: string;
  stepNo: number;
  roleId: string;
  roleCode: string;
  roleNameId: string;
  roleNameEn: string;
};

/** A role the step editor can assign — the active roles. */
export type RolePickRow = {
  id: string;
  code: string;
  nameId: string;
  nameEn: string;
};

/** A non-2xx response, carrying the server's localized message + machine key (409 conflict, 422 deadlock). */
export class ApprovalRouteApiError extends Error {
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
  const res = await fetch(apiUrl(`/console/approval-routes${path}${sep}lang=${locale}`), {
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
    throw new ApprovalRouteApiError(
      res.status,
      e.code ?? "internal",
      e.messageKey ?? "error.internal",
      e.message ?? `HTTP ${res.status}`,
      e.params,
    );
  }
  return (await res.json()) as T;
};

/* ── route headers (M2.1 master CRUD surface) ─────────────────────────────────── */

export const listRoutes = (locale: string): Promise<ApprovalRouteRow[]> =>
  request<{ items: ApprovalRouteRow[] }>("", locale).then((r) => r.items);

export const createRoute = (
  locale: string,
  body: Record<string, unknown>,
): Promise<ApprovalRouteRow> =>
  request<{ item: ApprovalRouteRow }>("", locale, {
    method: "POST",
    body: JSON.stringify(body),
  }).then((r) => r.item);

export const updateRoute = (
  locale: string,
  id: string,
  body: Record<string, unknown>,
): Promise<ApprovalRouteRow> =>
  request<{ item: ApprovalRouteRow }>(`/${id}`, locale, {
    method: "PATCH",
    body: JSON.stringify(body),
  }).then((r) => r.item);

export const deactivateRoute = (locale: string, id: string): Promise<ApprovalRouteRow> =>
  request<{ item: ApprovalRouteRow }>(`/${id}`, locale, { method: "DELETE" }).then((r) => r.item);

export const reactivateRoute = (locale: string, id: string): Promise<ApprovalRouteRow> =>
  request<{ item: ApprovalRouteRow }>(`/${id}/reactivate`, locale, { method: "POST" }).then(
    (r) => r.item,
  );

/* ── ordered steps + role picker ──────────────────────────────────────────────── */

export const listRoles = (locale: string): Promise<RolePickRow[]> =>
  request<{ roles: RolePickRow[] }>("/roles", locale).then((r) => r.roles);

export const listSteps = (locale: string, routeId: string): Promise<RouteStepRow[]> =>
  request<{ items: RouteStepRow[] }>(`/${routeId}/steps`, locale).then((r) => r.items);

/**
 * Replace a route's ordered steps. `roleIds` is the full ordered list (stepNo derived from order).
 * A deadlock (a step role with no eligible approver) comes back as a 422 `ApprovalRouteApiError`
 * (`messageKey: approvalRoutes.deadlock.warning`); re-send with `confirm: true` to override.
 */
export const replaceSteps = (
  locale: string,
  routeId: string,
  roleIds: string[],
  confirm = false,
): Promise<RouteStepRow[]> =>
  request<{ items: RouteStepRow[] }>(`/${routeId}/steps`, locale, {
    method: "PUT",
    body: JSON.stringify({ steps: roleIds.map((roleId) => ({ roleId })), confirm }),
  }).then((r) => r.items);
