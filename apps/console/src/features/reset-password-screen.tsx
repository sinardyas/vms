/**
 * Staff Console — password reset landing (M6.5d, #92, ADR-0004).
 *
 * Where `${APP_CONSOLE_URL}/reset-password` goes — the destination M1.5's admin reset (#24) has been
 * mailing staff since it shipped, and which existed nowhere until this ticket. Two flows arrive here,
 * and the second is why the gap mattered:
 *
 * - an admin **reset** an existing staff member's password;
 * - an admin **created** an internal user, which deliberately stores no temporary secret (#24) — so
 *   this link is the *only* way that account is ever reachable. A staff member invited before now got
 *   an email, followed it, and landed on the console's root.
 *
 * **Unlike the portal's `/set-password`, this does not sign anyone in**, though it easily could. The
 * console's front door is not just a session: `AuthScreen`'s `admit()` reconciles against `/me` and
 * turns away a deactivated account or a vendor, and signs the refused session back out (#97). Landing
 * a reset straight into the shell would route around that check — the one place a console session is
 * decided. So a saved password hands off to the sign-in form, which is also the flow staff already
 * know. The portal's asymmetry is deliberate: a vendor arriving from an invitation is a stranger
 * being onboarded, and has no equivalent gate to satisfy.
 */

import type { MessageKey } from "@vms/domain";
import { Button, Field, Input, useT } from "@vms/ui";
import { useState } from "react";
import { setPassword } from "../lib/auth";
import { AuthFrame } from "./auth-screen";

/** Leave the landing page for the console's front door, retiring the spent token in the URL. */
const goToSignIn = (): void => {
  window.location.replace("/");
};

/** A landing that only reports an outcome: heading, explanation, one way onward. */
function Notice({ title, body }: { title: MessageKey; body: MessageKey }) {
  const t = useT();
  return (
    <AuthFrame>
      <h1 className="text-2xl font-extrabold tracking-tight text-foreground">{t(title)}</h1>
      <p className="mt-2 text-sm text-muted-foreground">{t(body)}</p>
      <Button variant="secondary" className="mt-6 w-full" onClick={goToSignIn} type="button">
        {t("console.reset.backToSignIn")}
      </Button>
    </AuthFrame>
  );
}

export function ResetPasswordScreen({ params }: { params: URLSearchParams }) {
  const t = useT();
  const token = params.get("token");

  const [password, setPasswordValue] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  // No token, or better-auth bounced the link here with `?error=INVALID_TOKEN`. Invalid, expired and
  // already-used all arrive as that one code, so the copy names the outcome (the link is spent) and
  // the remedy (ask an admin) rather than guessing which of the three it was.
  if (!token || params.get("error")) {
    return <Notice title="console.reset.invalidTitle" body="console.reset.invalidBody" />;
  }
  if (done) {
    return <Notice title="console.reset.successTitle" body="console.reset.successBody" />;
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (password.length < 8) {
      setError(t("console.reset.passwordTooShort"));
      return;
    }
    if (password !== confirm) {
      setError(t("console.reset.passwordMismatch"));
      return;
    }
    setBusy(true);
    const res = await setPassword(token, password);
    setBusy(false);
    if (res.ok) {
      setDone(true);
      return;
    }
    // A 400 is `INVALID_TOKEN` — the link died between loading this page and submitting it.
    setError(res.status === 400 ? t("console.reset.invalidBody") : t("console.reset.failed"));
  };

  return (
    <AuthFrame>
      <div className="mb-2 text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground">
        {t("console.auth.eyebrow")}
      </div>
      <h1 className="text-2xl font-extrabold tracking-tight text-foreground">
        {t("console.reset.title")}
      </h1>
      <p className="mt-1 text-sm text-muted-foreground">{t("console.reset.subtitle")}</p>

      <form onSubmit={submit} className="mt-6 flex flex-col gap-4">
        <Field label={t("console.reset.newPassword")}>
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
        <Field label={t("console.reset.confirmPassword")} error={error ?? undefined}>
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
          {t("console.reset.submit")}
        </Button>
      </form>
    </AuthFrame>
  );
}
