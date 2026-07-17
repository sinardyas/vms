/**
 * Where credential emails land (M6.5d, #92, ADR-0004) — the link half of the auth surface.
 *
 * Every tokenized link the API mints is built by better-auth against the **API's** origin, and each
 * one ends in a redirect to a `callbackURL` that has to be a *page*. Those pages are in the SPAs, so
 * the API is what decides where they are — better-auth only carries the value through. Keeping the
 * four destinations here (rather than inline at each mint site) is what stops them drifting apart
 * from the routes the portal and console actually serve: a landing page and the link that points at
 * it are one decision, and this module is the one place it's made.
 *
 * The links themselves are opaque `${betterAuthUrl}/api/auth/...` URLs. What differs is the tail:
 *
 * - **verify** — `/verify-email?token=…&callbackURL=…`. better-auth defaults `callbackURL` to `"/"`,
 *   resolved against its *own* base URL, so an un-steered verification link lands on the API root —
 *   a JSON health blob, not a page. That default is exactly the "verify links land nowhere" half of
 *   #92, and {@link withCallbackURL} is the fix: the server overwrites the parameter rather than
 *   trusting the sign-up caller to pass one, so no client can forget it and none can redirect it
 *   somewhere we don't serve.
 * - **reset / invite** — `/reset-password/<token>?callbackURL=…`, which redirects to
 *   `<callbackURL>?token=<token>` on a good token and `<callbackURL>?error=INVALID_TOKEN` on a bad
 *   one. Both land on a page here; the page reads the query and does the rest.
 */

import { env } from "./env";

/**
 * Where a verification link lands: the portal's `/verified` page.
 *
 * Not the portal root, though `autoSignInAfterVerification` would make that mostly work — "mostly"
 * is the problem. A second click on the same link is a *success* to better-auth (already-verified
 * returns early) but mints no session, so a root landing would silently show the sign-in form with
 * nothing said; and an expired token arrives as `?error=TOKEN_EXPIRED`, which the root's session
 * gate has no vocabulary for. A page that owns the outcome can say which of the three happened.
 */
export const VERIFY_REDIRECT = `${env.portalUrl}/verified`;

/** Where an admin-initiated staff password reset lands (M1.5, #24): the console's own page. */
export const CONSOLE_RESET_REDIRECT = `${env.consoleUrl}/reset-password`;

/**
 * Where an office vendor's invitation lands (M6.2, #78): the portal's `/set-password` page.
 *
 * Two things ride along, and both are load-bearing:
 *
 * - `invite=1` is the **signal** {@link isOfficeInviteLink} reads back in `sendResetPassword` to tell
 *   an invitation from a plain forgot-password reset. better-auth has no "mint a token without
 *   mailing it" API, so the invite is delivered *from* the reset callback and needs a way to know
 *   which it is. Carrying the intent on the link keeps that stateless — no map of in-flight invites.
 * - `email` is what lets the page sign the owner in once they've chosen a password. better-auth's
 *   reset endpoint deliberately creates no session, and the form only knows the password half of the
 *   credential — so without the address here, "set your password" would have to dead-end at a login
 *   form asking the vendor to retype the email we just mailed. It is their own address, in their own
 *   inbox, on a link that already carries a credential token: naming it adds no exposure the token
 *   didn't already have.
 */
export const officeInviteRedirect = (email: string): string => {
  const url = new URL(`${env.portalUrl}/set-password`);
  url.searchParams.set("invite", "1");
  url.searchParams.set("email", email);
  return url.href;
};

/**
 * Was this reset link minted for an office invite rather than a plain forgot-password?
 *
 * The `redirectTo` we passed in arrives back embedded — and URI-encoded — in the link's
 * `callbackURL`, so the marker is matched in its encoded form (`invite%3D1`) rather than by parsing
 * a URL out of a URL.
 */
export const isOfficeInviteLink = (url: string): boolean =>
  url.includes(encodeURIComponent("invite=1"));

/**
 * Point a better-auth link at `callbackURL`, replacing whatever it was built with.
 *
 * Used on the verification link, whose `callbackURL` better-auth derives from the sign-up request
 * (defaulting to its own root). Rewriting it server-side means the destination is the API's decision
 * — one that every caller inherits and none can override.
 */
export const withCallbackURL = (url: string, callbackURL: string): string => {
  const rewritten = new URL(url);
  rewritten.searchParams.set("callbackURL", callbackURL);
  return rewritten.href;
};
