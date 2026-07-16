/**
 * Vendor Portal → better-auth REST (M3.5, #46, ADR-0004).
 *
 * Account-first self-registration: a vendor signs up (email + password), verifies their email (the
 * server sends a link via Mailpit in dev — `requireEmailVerification` is on), then signs in to build a
 * session. Portal vs console is authorization, not separate auth — both hit the same `/api/auth/*`
 * better-auth surface. The `kind` field is forced to `vendor` server-side, so a public sign-up always
 * yields a vendor without the client choosing.
 *
 * Every call sends/receives the session cookie (`credentials: "include"`); the API's CORS allows it.
 * These return a plain `{ ok, status, data }` so screens can branch without a thrown-error dance —
 * an unverified sign-in simply comes back `ok: false`.
 */

import { apiUrl } from "./api";

export type AuthResult = { ok: boolean; status: number; data: unknown };

const post = async (path: string, body: Record<string, unknown>): Promise<AuthResult> => {
  const res = await fetch(apiUrl(path), {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
};

/** Create a vendor account. Triggers the verification email; no session until the email is verified. */
export const signUp = (email: string, password: string, name: string): Promise<AuthResult> =>
  post("/api/auth/sign-up/email", { email, password, name });

/** Sign in. Fails (non-2xx) on a wrong credential or an as-yet-unverified email. */
export const signIn = (email: string, password: string): Promise<AuthResult> =>
  post("/api/auth/sign-in/email", { email, password });

/** End the session. */
export const signOut = (): Promise<AuthResult> => post("/api/auth/sign-out", {});
