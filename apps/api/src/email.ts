/**
 * Transactional email (M1.1, #20, ADR-0004/0015).
 *
 * The SMTP seam better-auth's verification / password-reset callbacks send through: Mailpit in
 * dev (UAT testers read the messages at :8025), a real SMTP host via the staging overlay. Bodies
 * are rendered from the `@vms/domain` i18n catalogue in the recipient's locale (defaulting to `id`),
 * so no copy is hard-coded (Definition-of-Done). Bilingual templates live as `auth.email.*` keys.
 */

import { type Locale, type MessageKey, translate } from "@vms/domain";
import nodemailer, { type Transporter } from "nodemailer";
import { env } from "./env";

// One shared transport, created lazily so importing this module (e.g. in tests) never opens a
// connection. Mailpit accepts any/no auth; a real host supplies credentials via env in staging.
let transport: Transporter | undefined;
const mailer = (): Transporter => {
  transport ??= nodemailer.createTransport({
    host: env.smtpHost,
    port: env.smtpPort,
    secure: env.smtpSecure, // Mailpit/dev: plaintext on 1025; a real relay negotiates STARTTLS/TLS.
    // Only attach credentials when supplied — Mailpit accepts anonymous mail; real relays require auth.
    ...(env.smtpUser ? { auth: { user: env.smtpUser, pass: env.smtpPass } } : {}),
  });
  return transport;
};

/** A rendered link email: heading + explanatory body + a CTA button, with a copy-paste fallback. */
type LinkEmail = {
  readonly to: string;
  readonly locale: Locale;
  readonly subjectKey: MessageKey;
  readonly headingKey: MessageKey;
  readonly bodyKey: MessageKey;
  readonly ctaKey: MessageKey;
  readonly url: string;
  readonly name: string;
  readonly expiryMinutes: number;
};

/** Minimal, client-agnostic HTML — inline styles only, since email clients strip <style> blocks. */
const renderHtml = (e: LinkEmail): string => {
  const t = (key: MessageKey, params?: Record<string, string | number>) =>
    translate(key, e.locale, params);
  return `<!doctype html>
<html lang="${e.locale}">
  <body style="margin:0;padding:24px;background:#f5f6f8;font-family:Inter,Arial,sans-serif;color:#1a1a1a;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;margin:0 auto;background:#fff;border-radius:12px;padding:32px;">
      <tr><td>
        <h1 style="margin:0 0 16px;font-size:20px;color:#002d5a;">${t(e.headingKey)}</h1>
        <p style="margin:0 0 24px;font-size:15px;line-height:1.5;">${t(e.bodyKey, { name: e.name })}</p>
        <p style="margin:0 0 24px;">
          <a href="${e.url}" style="display:inline-block;background:#0071e3;color:#fff;text-decoration:none;padding:12px 24px;border-radius:8px;font-size:15px;font-weight:600;">${t(e.ctaKey)}</a>
        </p>
        <p style="margin:0 0 8px;font-size:13px;color:#666;">${t("auth.email.linkFallback")}</p>
        <p style="margin:0 0 24px;font-size:13px;word-break:break-all;"><a href="${e.url}" style="color:#0071e3;">${e.url}</a></p>
        <p style="margin:0 0 8px;font-size:13px;color:#666;">${t("auth.email.expiry", { minutes: e.expiryMinutes })}</p>
        <p style="margin:0 0 24px;font-size:13px;color:#666;">${t("auth.email.ignore")}</p>
        <p style="margin:0;font-size:13px;color:#666;">${t("auth.email.signature")}</p>
      </td></tr>
    </table>
  </body>
</html>`;
};

/** Plain-text alternative for clients that don't render HTML. */
const renderText = (e: LinkEmail): string => {
  const t = (key: MessageKey, params?: Record<string, string | number>) =>
    translate(key, e.locale, params);
  return [
    t(e.headingKey),
    "",
    t(e.bodyKey, { name: e.name }),
    "",
    `${t(e.ctaKey)}: ${e.url}`,
    "",
    t("auth.email.expiry", { minutes: e.expiryMinutes }),
    t("auth.email.ignore"),
    "",
    t("auth.email.signature"),
  ].join("\n");
};

const sendLinkEmail = async (e: LinkEmail): Promise<void> => {
  await mailer().sendMail({
    from: env.smtpFrom,
    to: e.to,
    subject: translate(e.subjectKey, e.locale),
    html: renderHtml(e),
    text: renderText(e),
  });
};

/** Details every auth email shares: who it's for and the tokenized action link. */
type AuthEmail = { to: string; name: string; url: string; locale?: Locale };

/** Email-verification link (sent on signup). Token TTL mirrors better-auth's `expiresIn` (1h). */
export const sendVerificationEmail = (e: AuthEmail): Promise<void> =>
  sendLinkEmail({
    to: e.to,
    name: e.name,
    url: e.url,
    locale: e.locale ?? "id",
    subjectKey: "auth.email.verify.subject",
    headingKey: "auth.email.verify.heading",
    bodyKey: "auth.email.verify.body",
    ctaKey: "auth.email.verify.cta",
    expiryMinutes: 60,
  });

/** Password-reset link. Token TTL mirrors better-auth's reset `expiresIn` (1h). */
export const sendPasswordResetEmail = (e: AuthEmail): Promise<void> =>
  sendLinkEmail({
    to: e.to,
    name: e.name,
    url: e.url,
    locale: e.locale ?? "id",
    subjectKey: "auth.email.reset.subject",
    headingKey: "auth.email.reset.heading",
    bodyKey: "auth.email.reset.body",
    ctaKey: "auth.email.reset.cta",
    expiryMinutes: 60,
  });
