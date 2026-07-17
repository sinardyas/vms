/**
 * Staff Console — sign-in screen (M6.5g, #97, ADR-0004).
 *
 * The console's front door, which it went six milestones without: a centred card on the navy field,
 * mirroring the prototype's `staff_console.html` login (the portal's split marketing-hero look is for
 * strangers; staff arrive knowing what this is). Controls are the design system's `Field`/`Input`
 * rather than the prototype's inset-icon inputs, so the form inherits the same labelling and error
 * wiring as every other screen.
 *
 * Sign-in only — no register, no SSO. Staff accounts are provisioned (M6.5a seeds them, M1.5's admin
 * invites them), and the prototype's "Continue with SSO" button has nothing behind it in Phase 0.
 *
 * **Signing in is not the same as getting in.** better-auth authenticates the credential, but `active`
 * and `kind` are our columns, not its — so a deactivated staff member or a vendor gets a real session
 * from a correct password. This screen reconciles against `/me` before admitting anyone, and signs a
 * refused session back out rather than leaving a useless cookie behind. Without that, a deactivated
 * account would bounce back to this card with nothing said (`/me` 401 → still "anonymous"), which is
 * the blank-screen failure #97 called out.
 */

import { Anchor } from "@phosphor-icons/react";
import { APP_NAME, type MessageKey } from "@vms/domain";
import { Button, Field, Input, LocaleSwitch, useT } from "@vms/ui";
import { useState } from "react";
import { loadCapabilities } from "../lib/api";
import { signIn, signOut } from "../lib/auth";

/** The prototype's login field: deep navy with the two blue radial washes (staff_console.html:36). */
const BACKDROP =
  "radial-gradient(circle at 15% 15%, rgba(0,113,227,0.30), transparent 40%), radial-gradient(circle at 85% 85%, rgba(0,113,227,0.15), transparent 40%), #001a36";

/**
 * The navy field, the brand lockup, and the card the screen fills in.
 *
 * Exported so the credential landing page (M6.5d, `reset-password-screen.tsx`) is the same front
 * door: a staff member following an emailed link arrives at the console they recognise, not at a
 * second, differently-dressed login surface.
 */
export function AuthFrame({ children }: { children: React.ReactNode }) {
  const t = useT();
  return (
    <div
      className="flex min-h-screen items-center justify-center p-4"
      style={{ background: BACKDROP }}
    >
      <div className="absolute right-4 top-4">
        <LocaleSwitch />
      </div>
      <div className="w-full max-w-md">
        {/* Brand lockup above the card — the prototype's anchor mark + Soechi VMS / Staff Console. */}
        <div className="mb-7 flex items-center justify-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary shadow-lg">
            <Anchor weight="fill" className="h-6 w-6 text-primary-foreground" />
          </div>
          <div>
            <div className="text-lg font-extrabold tracking-tight text-white">{APP_NAME}</div>
            <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-[#7fb5ee]">
              {t("console.shell.subtitle")}
            </div>
          </div>
        </div>

        <div className="rounded-2xl bg-card p-9 shadow-2xl">{children}</div>
      </div>
    </div>
  );
}

/**
 * Decide whether a freshly-minted session may use the console, and say why not when it may not.
 * Returns `null` on success, else the message key to show. A refused session is signed out here: it
 * authenticated, so the cookie is real, and leaving it set would make the next `/me` a silent 401.
 */
const admit = async (): Promise<MessageKey | null> => {
  // `null` = /me answered 401. The credential was accepted a moment ago, so the session exists — the
  // only way our resolver refuses it is `users.active = false` (see api/src/session-actor.ts).
  const mirror = await loadCapabilities().catch(() => null);
  if (!mirror) {
    await signOut();
    return "console.auth.inactiveError";
  }
  if (mirror.actor.kind !== "internal") {
    await signOut();
    return "console.auth.notStaffError";
  }
  return null;
};

export function AuthScreen({ onSignedIn }: { onSignedIn: () => void }) {
  const t = useT();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<MessageKey | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await signIn(email, password);
    // One message for wrong password / unknown email / unverified address — better-auth doesn't
    // distinguish them to the client, and naming which one failed would confirm an account exists.
    const failure = res.ok ? await admit() : "console.auth.signInError";
    setBusy(false);
    if (failure) setError(failure);
    else onSignedIn();
  };

  return (
    <AuthFrame>
      <div className="mb-2 text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground">
        {t("console.auth.eyebrow")}
      </div>
      <h1 className="text-2xl font-extrabold tracking-tight text-foreground">
        {t("console.auth.title")}
      </h1>
      <p className="mt-1 text-sm text-muted-foreground">{t("console.auth.subtitle")}</p>

      <form onSubmit={submit} className="mt-6 flex flex-col gap-4">
        <Field label={t("console.auth.email")}>
          {(p) => (
            <Input
              {...p}
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          )}
        </Field>
        {/* The error rides the password field — the same place the portal puts it, and the field
            a signed-out staff member will retry first. */}
        <Field label={t("console.auth.password")} error={error ? t(error) : undefined}>
          {(p) => (
            <Input
              {...p}
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          )}
        </Field>
        <Button type="submit" disabled={busy} className="w-full">
          {t("console.auth.signIn")}
        </Button>
      </form>

      <p className="mt-6 border-t border-border pt-4 text-center text-xs leading-relaxed text-muted-foreground">
        {t("console.auth.footnote")}
      </p>
    </AuthFrame>
  );
}
