/**
 * Zod ↔ Result bridge and schema conventions (M0.3, ADR-0008).
 *
 * Every domain boundary validates input by running a Zod schema through {@link parseWith},
 * which returns the {@link Result} the rest of the domain speaks — a typed value on success,
 * a validation {@link DomainError} (carrying the Zod issues as diagnostic `details`) on failure.
 *
 * This is where later milestones hang their shared schemas: M3's per-origin vendor
 * required-field sets, M4's approval-request payloads, etc. Import the enum schemas from
 * `values/enums.ts`; import the primitives from `./common`.
 */

import type { z } from "zod";
import { type DomainError, validationError } from "../errors";
import { type Result, err, ok } from "../result";

export * from "./common";
export * from "./vendor";
export * from "./vendor-bank";
export * from "./vendor-change";
export * from "./vendor-document";
export * from "./vendor-submit";

/** Convert a Zod error into a typed validation DomainError (issues ride along as `details`). */
export const zodError = (error: z.ZodError): DomainError =>
  validationError({ details: error.issues });

/**
 * Validate `input` against `schema`, returning a `Result` instead of throwing.
 * On failure the error is a `validation` DomainError with the Zod issues in `details`.
 */
export const parseWith = <T>(schema: z.ZodType<T>, input: unknown): Result<T, DomainError> => {
  const parsed = schema.safeParse(input);
  return parsed.success ? ok(parsed.data) : err(zodError(parsed.error));
};
