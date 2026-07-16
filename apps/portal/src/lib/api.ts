/**
 * Vendor Portal → API access (M3.5, #46).
 *
 * The API is a separate origin (its own service / port), so its base URL is baked at build time from
 * `VITE_API_URL` (see the Dockerfile build arg / docker-compose), falling back to the dev port. Every
 * portal → API call goes through {@link request} so the base, the session cookie, the active-locale
 * `?lang` (server localizes its errors), and the JSON-vs-multipart body handling all live in one place.
 */

import type { CapabilityFlags } from "@vms/domain";

export const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:3001";

/** Build an absolute API URL for `path` (which must start with `/`). */
export const apiUrl = (path: string): string => `${API_URL}${path}`;

/**
 * A non-2xx response, carrying the server's localized message + machine key/params (e.g. a 409
 * `error.vendor.taxIdDuplicate`). Screens branch on `messageKey`/`status` and render `message`.
 */
export class PortalApiError extends Error {
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
 * sent as JSON (content-type set); a `FormData` body is left untouched so its multipart boundary
 * survives (file uploads). Non-2xx throws a {@link PortalApiError} built from the server's `error`.
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
    throw new PortalApiError(
      res.status,
      e.code ?? "internal",
      e.messageKey ?? "error.internal",
      e.message ?? `HTTP ${res.status}`,
      e.params,
    );
  }
  return (await res.json()) as T;
}

/**
 * Load the signed-in vendor's capability grid from `GET /me` (M1.3). `credentials: "include"` sends the
 * better-auth session cookie cross-origin. A 401 means no session (or unverified email) → `null`, so the
 * app treats "not signed in" as deny-all and shows the auth screens rather than erroring.
 */
export async function loadCapabilities(): Promise<CapabilityFlags | null> {
  const res = await fetch(apiUrl("/me"), { credentials: "include" });
  if (res.status === 401) return null;
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const body = (await res.json()) as { capabilities: CapabilityFlags };
  return body.capabilities;
}
