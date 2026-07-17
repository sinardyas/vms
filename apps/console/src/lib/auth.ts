/**
 * Staff Console → better-auth REST (M6.5g, #97, ADR-0004).
 *
 * The console had no auth client at all until this ticket: it only *worked* because the API's
 * dev-actor seam (`DEV_ACTOR=1`) resolved every request as a fake superuser with no session behind
 * it. With the seam off — which is exactly how the staging overlay ships, since it pins
 * `NODE_ENV=production` — `/me` answered 401 and there was no way to sign in.
 *
 * Portal vs console is *authorization*, not separate auth (ADR-0004): both audiences hit the same
 * `/api/auth/*` surface, so this mirrors `apps/portal/src/lib/auth.ts`. The one asymmetry is that
 * there is **no sign-up** — staff accounts are provisioned (seeded in M6.5a, or invited by an admin),
 * and better-auth's public sign-up forces `kind: "vendor"` anyway, so a console sign-up could only
 * ever mint the wrong kind of account.
 *
 * Every call sends/receives the session cookie (`credentials: "include"`); the API's CORS allows it.
 * Results come back as a plain `{ ok, status }` so screens branch without a thrown-error dance.
 */

import { apiUrl } from "./api";

export type AuthResult = { ok: boolean; status: number };

const post = async (path: string): Promise<AuthResult> => {
  const res = await fetch(apiUrl(path), {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({}),
  });
  return { ok: res.ok, status: res.status };
};

/**
 * Sign in a staff member. Fails (non-2xx) on a wrong credential — and also on an unverified email,
 * since `requireEmailVerification` is on for the whole surface (ADR-0004); seeded staff accounts are
 * created `emailVerified: true` so this only bites a hand-made one.
 *
 * A successful call means better-auth minted a session — **not** that the console will admit them.
 * `active` and `kind` are our columns, not better-auth's, so a deactivated or vendor account signs in
 * here and is refused by `/me` (401) or the kind check. The screen reconciles against `/me` before it
 * lets anyone in; see `features/auth-screen.tsx`.
 */
export const signIn = async (email: string, password: string): Promise<AuthResult> => {
  const res = await fetch(apiUrl("/api/auth/sign-in/email"), {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  return { ok: res.ok, status: res.status };
};

/** End the session. The caller reloads the capability mirror, which flips the app back to signed-out. */
export const signOut = (): Promise<AuthResult> => post("/api/auth/sign-out");

/**
 * Set the account's password from an emailed token (M6.5d, #92) — an admin-initiated reset, and also
 * the *first* password of an admin-created internal user (M1.5, #24), which stores no temporary
 * secret and so has no other way in. The token comes off the landing page's query, put there by
 * better-auth's redirect; the field is `newPassword`, not `password`.
 *
 * A non-2xx is almost always `INVALID_TOKEN` — better-auth answers invalid, expired, and
 * already-consumed tokens identically, so the caller can't distinguish them and must not guess.
 * This mints no session: staff sign in afterwards, which is what runs the console's `admit()` check.
 */
export const setPassword = async (token: string, newPassword: string): Promise<AuthResult> => {
  const res = await fetch(apiUrl("/api/auth/reset-password"), {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ token, newPassword }),
  });
  return { ok: res.ok, status: res.status };
};
