/**
 * Console → Access-admin API client (M1.5, #24).
 *
 * Typed wrappers over `/console/access/*` — the Users/Roles/matrix endpoints. Every call sends the
 * better-auth session cookie (`credentials: "include"`) and the active locale (`?lang`) so a guard
 * refusal (401/403) or a deadlock warning (422) comes back already localized. Non-2xx responses throw
 * an {@link AccessApiError} carrying the server's `messageKey` + `params`, so the screen can tell a
 * deadlock warning apart from an ordinary failure and re-submit with `confirm: true`.
 *
 * DTO shapes mirror `apps/api`'s `access-service` (the console can't import across the app boundary),
 * keyed to the domain's `RbacModule` / `RbacVerb` so the matrix stays the canonical 9×5.
 */

import type { RbacModule, RbacVerb } from "@vms/domain";
import { apiUrl } from "./api";

export type MatrixGrid = Record<RbacModule, Record<RbacVerb, boolean>>;

export type RoleDTO = {
  id: string;
  code: string;
  nameId: string;
  nameEn: string;
  active: boolean;
  leadUserId: string | null;
  userCount: number;
  matrix: MatrixGrid;
};

export type UserRoleRef = { id: string; code: string; nameId: string; nameEn: string };

export type UserDTO = {
  id: string;
  email: string;
  name: string;
  kind: "vendor" | "internal";
  active: boolean;
  roles: UserRoleRef[];
};

export type CriticalHolders = { module: RbacModule; verb: RbacVerb; holders: number };

/** A non-2xx response, carrying the server's localized message + machine key (for deadlock detection). */
export class AccessApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly messageKey: string,
    override readonly message: string,
    readonly params?: Record<string, string | number>,
  ) {
    super(message);
  }

  /** The re-confirmable deadlock warning (ADR-0011b) — a 422 the user may override with `confirm`. */
  get isDeadlock(): boolean {
    return this.messageKey === "access.deadlock.warning";
  }
}

const request = async <T>(path: string, locale: string, init?: RequestInit): Promise<T> => {
  const sep = path.includes("?") ? "&" : "?";
  const res = await fetch(apiUrl(`/console/access${path}${sep}lang=${locale}`), {
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
    throw new AccessApiError(
      res.status,
      e.code ?? "internal",
      e.messageKey ?? "error.internal",
      e.message ?? `HTTP ${res.status}`,
      e.params,
    );
  }
  return (await res.json()) as T;
};

// --- Roles ---
export const listRoles = (locale: string) =>
  request<{ roles: RoleDTO[] }>("/roles", locale).then((r) => r.roles);

export type RolePayload = {
  code?: string;
  nameId?: string;
  nameEn?: string;
  leadUserId?: string | null;
  active?: boolean;
  matrix?: MatrixGrid;
  confirm?: boolean;
};

export const createRole = (locale: string, body: RolePayload) =>
  request<{ role: RoleDTO }>("/roles", locale, { method: "POST", body: JSON.stringify(body) }).then(
    (r) => r.role,
  );

export const updateRole = (locale: string, id: string, body: RolePayload) =>
  request<{ role: RoleDTO }>(`/roles/${id}`, locale, {
    method: "PATCH",
    body: JSON.stringify(body),
  }).then((r) => r.role);

export const deactivateRole = (locale: string, id: string) =>
  request<{ role: RoleDTO }>(`/roles/${id}`, locale, { method: "DELETE" }).then((r) => r.role);

// --- Users ---
export const listUsers = (locale: string) =>
  request<{ users: UserDTO[] }>("/users", locale).then((r) => r.users);

export const createUser = (
  locale: string,
  body: { email: string; name: string; roleIds: string[] },
) =>
  request<{ user: UserDTO }>("/users", locale, { method: "POST", body: JSON.stringify(body) }).then(
    (r) => r.user,
  );

export const updateUser = (
  locale: string,
  id: string,
  body: { name?: string; active?: boolean; roleIds?: string[]; confirm?: boolean },
) =>
  request<{ user: UserDTO }>(`/users/${id}`, locale, {
    method: "PATCH",
    body: JSON.stringify(body),
  }).then((r) => r.user);

export const resetPassword = (locale: string, id: string) =>
  request<{ ok: true; email: string }>(`/users/${id}/reset-password`, locale, { method: "POST" });

// --- Eligibility (deadlock-guard context) ---
export const listEligibility = (locale: string) =>
  request<{ critical: CriticalHolders[] }>("/eligibility", locale).then((r) => r.critical);
