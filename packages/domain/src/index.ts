/**
 * @vms/domain — the framework-agnostic domain core (M0.3, ADR-0008).
 *
 * The shared substrate both the Hono API and the React apps import: result/error conventions,
 * the stable value types (mirroring `@vms/db`'s enums), Zod as the single source of validation,
 * and the bilingual (ID + EN) i18n catalogue with locale resolution. Every user-facing string is
 * an i18n key — the Definition-of-Done rule enforced from here on.
 *
 * No feature logic yet: this is what M1's RBAC `can()`, M4's approval engine, and every M3
 * validator build on. Keep this package **stack-neutral** — no Hono, React, or Drizzle imports.
 */

// Result / error conventions
export * from "./result";
export * from "./errors";

// Shared value types (enums + locale)
export * from "./values";

// Access control — request context, actor identity, RBAC `can()` + capability contract (M0.4)
export * from "./access";

// Master-data framework — bilingual labels + referential-integrity contract (M2.1)
export * from "./master";

// Zod validation (bridge + shared primitives)
export * from "./schemas";

// i18n catalogue + locale resolution
export * from "./i18n";

// App-wide constants (consumed by the API and both UI shells).
export const APP_NAME = "Soechi VMS";
export const PHASE = "phase-0" as const;
