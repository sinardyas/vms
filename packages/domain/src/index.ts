/**
 * @vms/domain — framework-agnostic domain core.
 *
 * Placeholder for the scaffold (ticket #2). The real contents — result/error conventions,
 * shared value types, Zod schemas, and the bilingual i18n catalogue — land in ticket #6.
 * Keep this package free of Hono/React imports (it is imported by both API and UIs).
 */

export const APP_NAME = "Soechi VMS";
export const PHASE = "phase-0" as const;

export type Locale = "id" | "en";
export const LOCALES: readonly Locale[] = ["id", "en"];
export const DEFAULT_LOCALE: Locale = "id";
