/**
 * Vendor Portal — authentication screens (M3.5, #46, ADR-0004).
 *
 * The account-first entry point: a split screen (form left, navy marketing hero right — the prototype's
 * `vendor_portal.html` login look) that toggles between Sign in and Register, plus a post-signup
 * "check your email" notice (email verification is required before a session exists). On a successful
 * sign-in the parent re-loads the capability grid (`onSignedIn`) and the app swaps to the portal shell.
 *
 * Bilingual throughout (`portal.auth.*`); no strings are hard-coded. A locale switch sits in the corner.
 */

import { useT } from "@vms/ui";
import { Button, Field, Input, LocaleSwitch } from "@vms/ui";
import { useState } from "react";
import { signIn, signUp } from "../lib/auth";

type Mode = "signin" | "register" | "verify";

/** The navy marketing panel beside the form — the prototype's login hero (#002d5a). */
function Hero() {
  const t = useT();
  return (
    <div
      className="hidden flex-1 flex-col justify-center gap-4 p-12 text-white lg:flex"
      style={{
        background:
          "radial-gradient(circle at 20% 20%, rgba(0,113,227,0.35), transparent 45%), radial-gradient(circle at 80% 80%, rgba(0,113,227,0.25), transparent 45%), #002d5a",
      }}
    >
      <h2 className="text-3xl font-bold leading-tight">{t("portal.auth.heroTitle")}</h2>
      <p className="max-w-md text-base text-white/80">{t("portal.auth.heroBody")}</p>
    </div>
  );
}

/** Shared form frame: brand, locale switch, and the panel the mode fills in. */
function Frame({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen bg-background">
      <div className="flex flex-1 flex-col justify-center px-6 py-10 sm:px-12 lg:px-16">
        <div className="absolute right-4 top-4">
          <LocaleSwitch />
        </div>
        <div className="mx-auto w-full max-w-sm">{children}</div>
      </div>
      <Hero />
    </div>
  );
}

export function AuthScreens({ onSignedIn }: { onSignedIn: () => void }) {
  const t = useT();
  const [mode, setMode] = useState<Mode>("signin");

  if (mode === "verify") {
    return (
      <Frame>
        <h1 className="text-2xl font-bold text-foreground">{t("portal.auth.verifyTitle")}</h1>
        <p className="mt-3 text-sm text-muted-foreground">{t("portal.auth.verifyBody")}</p>
        <Button
          variant="secondary"
          className="mt-6 w-full"
          onClick={() => setMode("signin")}
          type="button"
        >
          {t("portal.auth.backToSignIn")}
        </Button>
      </Frame>
    );
  }

  return (
    <Frame>
      {mode === "signin" ? (
        <SignInForm onSignedIn={onSignedIn} onRegister={() => setMode("register")} />
      ) : (
        <RegisterForm onRegistered={() => setMode("verify")} onBack={() => setMode("signin")} />
      )}
    </Frame>
  );
}

function SignInForm({
  onSignedIn,
  onRegister,
}: {
  onSignedIn: () => void;
  onRegister: () => void;
}) {
  const t = useT();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await signIn(email, password);
    setBusy(false);
    if (res.ok) onSignedIn();
    else setError(t("portal.auth.signInError"));
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <div>
        <h1 className="text-2xl font-bold text-foreground">{t("portal.auth.signInTitle")}</h1>
        <p className="mt-2 text-sm text-muted-foreground">{t("portal.auth.signInSubtitle")}</p>
      </div>
      <Field label={t("portal.auth.email")}>
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
      <Field label={t("portal.auth.password")} error={error ?? undefined}>
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
        {t("portal.auth.signIn")}
      </Button>
      <p className="text-center text-sm text-muted-foreground">
        {t("portal.auth.newVendor")}{" "}
        <button
          type="button"
          onClick={onRegister}
          className="font-semibold text-primary hover:underline"
        >
          {t("portal.auth.registerHere")}
        </button>
      </p>
    </form>
  );
}

function RegisterForm({
  onRegistered,
  onBack,
}: {
  onRegistered: () => void;
  onBack: () => void;
}) {
  const t = useT();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

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
    const res = await signUp(email, password, name);
    setBusy(false);
    if (res.ok) onRegistered();
    else setError(t("portal.auth.signUpError"));
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <div>
        <h1 className="text-2xl font-bold text-foreground">{t("portal.auth.registerTitle")}</h1>
        <p className="mt-2 text-sm text-muted-foreground">{t("portal.auth.registerSubtitle")}</p>
      </div>
      <Field label={t("portal.auth.name")}>
        {(p) => (
          <Input
            {...p}
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoComplete="name"
            required
          />
        )}
      </Field>
      <Field label={t("portal.auth.email")}>
        {(p) => (
          <Input
            {...p}
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            required
          />
        )}
      </Field>
      <Field label={t("portal.auth.password")}>
        {(p) => (
          <Input
            {...p}
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="new-password"
            required
          />
        )}
      </Field>
      <Field label={t("portal.auth.confirmPassword")} error={error ?? undefined}>
        {(p) => (
          <Input
            {...p}
            type="password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            autoComplete="new-password"
            required
          />
        )}
      </Field>
      <Button type="submit" disabled={busy} className="w-full">
        {t("portal.auth.createAccount")}
      </Button>
      <button
        type="button"
        onClick={onBack}
        className="text-center text-sm font-semibold text-primary hover:underline"
      >
        {t("portal.auth.backToSignIn")}
      </button>
    </form>
  );
}
