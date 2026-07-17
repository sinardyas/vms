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

/**
 * Whether `key` is a real catalogue key — the runtime counterpart of the compile-time
 * {@link MessageKey} check.
 *
 * Needed where a key arrives as plain data rather than a literal, which in practice means keys read
 * back out of the database: an in-app notification row persists its `titleKey`/`bodyKey` (M6.1), so a
 * key that is renamed or dropped from the catalogue leaves already-written rows pointing at nothing.
 * `translate` would throw on those; callers guard with this and degrade the one row instead.
 */
export const isMessageKey = (key: string): key is MessageKey => key in catalogue;

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
 *
 * The unknown-key guard is load-bearing, not defensive padding: callers that build a key
 * dynamically (`t(`enum.origin.${value}` as MessageKey)`) cast past the `MessageKey` union,
 * so an absent entry reaches here at runtime having never failed a compile.
 */
export const translate = (
  key: MessageKey,
  locale: Locale = DEFAULT_LOCALE,
  params?: MessageParams,
): string => {
  const entry = catalogue[key];
  if (!entry) return key;
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
