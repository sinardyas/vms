/**
 * Vendor Portal — credential landing pages (M6.5d, #92, ADR-0004).
 *
 * The pages the API's tokenized emails have been redirecting to since M1.5 — and which existed in
 * neither SPA, so every one of them dead-ended. Two land here:
 *
 * - **`/set-password`** — an office-registered vendor's owner following their invitation (M6.2, #78).
 *   Until this page, the office-registration golden path stopped at the email: the account existed,
 *   the token was valid, and there was nowhere to spend it.
 * - **`/verified`** — where a self-signup's verification link returns (M1.1, #20).
 *
 * Both reuse `auth-screens.tsx`'s `Frame` — same split screen, same hero, same locale switch — because
 * a stranger arriving from an email should not be able to tell they've crossed an app boundary.
 *
 * **Failure is a first-class outcome here, not an edge.** These pages are reached by clicking a link
 * of unknown age, so the dead-token case is *ordinary*, and the DoD makes it explicit: an invalid,
 * expired, or already-used token must fail localized and legibly. better-auth collapses all three
 * into one `INVALID_TOKEN`, so the copy names none of them individually — it says the link is spent
 * and points at the human who can mint another.
 */

import { Button, Field, Input, useCapabilities, useT } from "@vms/ui";
import { useState } from "react";
import { setPassword, signIn } from "../lib/auth";
import { Frame } from "./auth-screens";

/** A landing that only reports an outcome: heading, explanation, one way onward. */
function Notice({
  title,
  body,
  action,
  onAction,
}: {
  title: string;
  body: string;
  action: string;
  onAction: () => void;
}) {
  return (
    <Frame>
      <h1 className="text-2xl font-bold text-foreground">{title}</h1>
      <p className="mt-3 text-sm text-muted-foreground">{body}</p>
      <Button variant="secondary" className="mt-6 w-full" onClick={onAction} type="button">
        {action}
      </Button>
    </Frame>
  );
}

/**
 * Leave the landing page for the portal proper.
 *
 * A full navigation to `/`, not a state flip: these pages are reached by URL, so the address bar
 * still reads `/set-password?token=…` — a spent, single-use token. Re-rendering in place would leave
 * it sitting there to be re-followed on a refresh, which would then fail (it's consumed) and tell a
 * freshly signed-in vendor their link is dead. Replacing the URL retires it.
 */
const enterPortal = (): void => {
  window.location.replace("/");
};

/**
 * `/set-password?token=…` — choose a password and land in a session.
 *
 * The address rides the query (`?email=`) because better-auth's reset endpoint mints no session and
 * the form only knows the password half of the credential; the API puts it there when it builds the
 * invite (see `credential-links.ts`). Without an address we can still set the password — that's the
 * part that matters — but we can't sign in, so the page says so and hands over to the sign-in form
 * rather than claiming a failure that didn't happen.
 */
export function SetPassword({ params }: { params: URLSearchParams }) {
  const t = useT();
  const { reload } = useCapabilities();
  const token = params.get("token");
  const isInvite = params.get("invite") === "1";
  const email = params.get("email");

  const [password, setPasswordValue] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // No token, or better-auth bounced the link here with `?error=INVALID_TOKEN` — there is nothing to
  // spend, so don't render a form that cannot succeed.
  if (!token || params.get("error")) {
    return (
      <Notice
        title={t("portal.setPassword.invalidTitle")}
        body={t("portal.setPassword.invalidBody")}
        action={t("portal.auth.backToSignIn")}
        onAction={enterPortal}
      />
    );
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (password.length < 8) {
      setError(t("portal.auth.passwordTooShort"));
      return;
    }
    if (password !== confirm) {
      setError(t("portal.auth.passwordMismatch"));
      return;
    }

    setBusy(true);
    const res = await setPassword(token, password);
    if (!res.ok) {
      setBusy(false);
      // A 400 here is `INVALID_TOKEN` — the link died between loading this page and submitting it
      // (expired, or spent in another tab). Swap the form for the dead-link notice rather than
      // leaving a filled-in form the vendor will retry forever.
      setError(
        res.status === 400 ? t("portal.setPassword.invalidBody") : t("portal.setPassword.failed"),
      );
      return;
    }

    // The credential is set; from here nothing can go wrong that costs the vendor their password.
    // The reset endpoint creates no session of its own, so sign in with what they just chose.
    if (!email) {
      setBusy(false);
      setNotice(t("portal.setPassword.savedSignInFailed"));
      return;
    }
    const signedIn = await signIn(email, password);
    setBusy(false);
    if (!signedIn.ok) {
      setNotice(t("portal.setPassword.savedSignInFailed"));
      return;
    }
    // `reload` re-reads `/me` so the app knows about the session; the navigation retires the token.
    reload();
    enterPortal();
  };

  if (notice) {
    return (
      <Notice
        title={t("portal.setPassword.inviteTitle")}
        body={notice}
        action={t("portal.auth.backToSignIn")}
        onAction={enterPortal}
      />
    );
  }

  return (
    <Frame>
      <form onSubmit={submit} className="flex flex-col gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground">
            {t(isInvite ? "portal.setPassword.inviteTitle" : "portal.setPassword.resetTitle")}
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {t(isInvite ? "portal.setPassword.inviteSubtitle" : "portal.setPassword.resetSubtitle")}
          </p>
        </div>
        {/* Shown, not editable: the invite is bound to this address by the token, so offering it as an
            input would imply a choice that doesn't exist. Absent on a link that carried no address. */}
        {email ? (
          <Field label={t("portal.auth.email")}>
            {(p) => <Input {...p} type="email" value={email} readOnly disabled />}
          </Field>
        ) : null}
        <Field label={t("portal.setPassword.newPassword")}>
          {(p) => (
            <Input
              {...p}
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPasswordValue(e.target.value)}
              required
            />
          )}
        </Field>
        <Field label={t("portal.auth.confirmPassword")} error={error ?? undefined}>
          {(p) => (
            <Input
              {...p}
              type="password"
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              required
            />
          )}
        </Field>
        <Button type="submit" disabled={busy} className="w-full">
          {t("portal.setPassword.submit")}
        </Button>
      </form>
    </Frame>
  );
}

/**
 * `/verified` — where the sign-up verification link returns.
 *
 * This page consumes nothing: better-auth verifies the token on its own `GET /verify-email` and then
 * redirects here, so by the time it renders the work is done and the outcome is entirely in the query.
 * `autoSignInAfterVerification` means a first click usually arrives already holding a session — but a
 * *second* click on the same link is an early-return success that mints none, so "verified" and
 * "signed in" aren't the same thing and the button leads to whichever the session state warrants.
 */
export function Verified({ params }: { params: URLSearchParams }) {
  const t = useT();
  const error = params.get("error");

  if (error === "TOKEN_EXPIRED") {
    return (
      <Notice
        title={t("portal.verified.expiredTitle")}
        body={t("portal.verified.expiredBody")}
        action={t("portal.auth.backToSignIn")}
        onAction={enterPortal}
      />
    );
  }
  if (error) {
    // INVALID_TOKEN / USER_NOT_FOUND — one message: the difference isn't actionable for the reader.
    return (
      <Notice
        title={t("portal.verified.invalidTitle")}
        body={t("portal.verified.invalidBody")}
        action={t("portal.auth.backToSignIn")}
        onAction={enterPortal}
      />
    );
  }
  return (
    <Notice
      title={t("portal.verified.title")}
      body={t("portal.verified.body")}
      action={t("portal.verified.continue")}
      onAction={enterPortal}
    />
  );
}
