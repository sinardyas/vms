/**
 * Locale resolution (M0.3, ADR-0008).
 *
 * Turns a {@link MessageKey} + {@link Locale} into a rendered string, with a strict fallback
 * chain: requested locale → default locale (`id`) → the raw key. Server-generated text (emails,
 * validation messages, enum labels) all flow through here, so nothing user-facing is hard-coded.
 */

import { DEFAULT_LOCALE, type Locale } from "../values/locale";
import { type MessageKey, catalogue } from "./keys";

/** Interpolation params for `{token}` placeholders in a message template. */
export type MessageParams = Readonly<Record<string, string | number>>;

/** Replace `{name}` tokens with params; unmatched tokens are left intact. */
const interpolate = (template: string, params?: MessageParams): string => {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (whole, token: string) =>
    token in params ? String(params[token]) : whole,
  );
};

/**
 * Resolve a message key to text in `locale`, falling back to the default locale and then to
 * the key itself (so a missing translation degrades visibly rather than crashing).
 */
export const translate = (
  key: MessageKey,
  locale: Locale = DEFAULT_LOCALE,
  params?: MessageParams,
): string => {
  const entry = catalogue[key];
  const template = entry[locale] ?? entry[DEFAULT_LOCALE] ?? key;
  return interpolate(template, params);
};

/**
 * Bind a locale once and get a translator — handy for a request scope where every string
 * shares the actor's locale (`const t = translator(ctx.locale); t("error.forbidden")`).
 */
export const translator =
  (locale: Locale) =>
  (key: MessageKey, params?: MessageParams): string =>
    translate(key, locale, params);
