/**
 * Credential-link destinations (M6.5d, #92).
 *
 * These assert the *round trip*, not the string: an invite redirect has to survive being URI-encoded
 * into a `callbackURL` by better-auth and still be recognised as an invite on the way back out —
 * that encode/decode pair is where the branch would silently break, and a plain-reset email would go
 * to an invited vendor instead of their invitation.
 */

import { describe, expect, test } from "bun:test";
import {
  CONSOLE_RESET_REDIRECT,
  VERIFY_REDIRECT,
  isOfficeInviteLink,
  officeInviteRedirect,
  withCallbackURL,
} from "./credential-links";

describe("officeInviteRedirect", () => {
  test("lands on the portal's set-password page carrying the invite marker + address", () => {
    const url = new URL(officeInviteRedirect("pic@vendor.co.id"));
    expect(url.pathname).toBe("/set-password");
    expect(url.searchParams.get("invite")).toBe("1");
    expect(url.searchParams.get("email")).toBe("pic@vendor.co.id");
  });

  test("survives better-auth's encoding of redirectTo into callbackURL", () => {
    // How the link comes back to `sendResetPassword`: our redirectTo, URI-encoded into the query.
    const link = `http://api.test/api/auth/reset-password/tok123?callbackURL=${encodeURIComponent(
      officeInviteRedirect("pic@vendor.co.id"),
    )}`;
    expect(isOfficeInviteLink(link)).toBe(true);

    // ...and back off it again the way better-auth reads it before redirecting: the query parser
    // decodes the parameter once (no second decode — that would over-decode the address inside it).
    const landed = new URL(new URL(link).searchParams.get("callbackURL") ?? "");
    expect(landed.searchParams.get("email")).toBe("pic@vendor.co.id");
  });

  test("an address needing escaping round-trips intact", () => {
    const email = "pic+office@vendor.co.id";
    const link = `http://api.test/api/auth/reset-password/t?callbackURL=${encodeURIComponent(
      officeInviteRedirect(email),
    )}`;
    // `+` is the trap: built by string concatenation it would survive to the page as a space, and the
    // sign-in would fail on an address the vendor never had. It has to arrive escaped (`%2B`).
    const landed = new URL(new URL(link).searchParams.get("callbackURL") ?? "");
    expect(landed.searchParams.get("email")).toBe(email);
    // The redirect better-auth finally issues, token appended — what the browser actually lands on.
    landed.searchParams.set("token", "tok123");
    expect(new URL(landed.href).searchParams.get("email")).toBe(email);
  });
});

describe("isOfficeInviteLink", () => {
  test("a plain reset link is not an invite", () => {
    const link = `http://api.test/api/auth/reset-password/tok?callbackURL=${encodeURIComponent(
      CONSOLE_RESET_REDIRECT,
    )}`;
    expect(isOfficeInviteLink(link)).toBe(false);
  });
});

describe("withCallbackURL", () => {
  test("replaces better-auth's default root callback, keeping the token", () => {
    const rewritten = new URL(
      withCallbackURL(
        `http://api.test/api/auth/verify-email?token=jwt.abc&callbackURL=${encodeURIComponent("/")}`,
        VERIFY_REDIRECT,
      ),
    );
    expect(rewritten.searchParams.get("callbackURL")).toBe(VERIFY_REDIRECT);
    expect(rewritten.searchParams.get("token")).toBe("jwt.abc");
  });
});
