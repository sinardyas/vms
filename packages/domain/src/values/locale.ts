/**
 * Locale value type (M0.3, ADR-0008).
 *
 * Two supported locales. Bahasa Indonesia is the default (the portal defaults to it;
 * foreign vendors may switch to English). Every resolvable message falls back to `id`.
 */

export const LOCALES = ["id", "en"] as const;
export type Locale = (typeof LOCALES)[number];

/** Default locale for the whole system, and the ultimate i18n fallback. */
export const DEFAULT_LOCALE: Locale = "id";

/** Narrow an arbitrary string (e.g. an `Accept-Language` fragment) to a supported Locale. */
export const isLocale = (value: unknown): value is Locale =>
  typeof value === "string" && (LOCALES as readonly string[]).includes(value);

/** Resolve a requested locale to a supported one, defaulting when unrecognised. */
export const resolveLocale = (requested: unknown): Locale =>
  isLocale(requested) ? requested : DEFAULT_LOCALE;
