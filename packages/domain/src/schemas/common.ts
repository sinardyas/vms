/**
 * Shared Zod primitives (M0.3, ADR-0008).
 *
 * Zod is the **single source of validation** for the whole system: the API validates request
 * bodies with these schemas, and the React portal reuses them client-side so both sides agree
 * on what "valid" means. This file holds the cross-cutting primitives; per-origin required-field
 * sets for vendor registration land here in M3 (see `schemas/index.ts`).
 *
 * Convention: schemas fail with structured issues, which {@link parseWith} turns into a typed
 * validation {@link DomainError} — callers get a `Result`, never a thrown ZodError.
 */

import { z } from "zod";
import { LOCALES } from "../values/locale";

/** A trimmed, non-empty string. The base for most free-text fields. */
export const nonEmptyString = z.string().trim().min(1);

/** Email — lower-cased and trimmed; identity is email-first (ADR-0004). */
export const emailSchema = z.string().trim().toLowerCase().email();

/** A UUID (primary keys are `uuid` across `@vms/db`). */
export const uuidSchema = z.string().uuid();

/** A supported locale. */
export const localeSchema = z.enum(LOCALES);
