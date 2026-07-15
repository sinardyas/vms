/**
 * Typed domain errors (M0.3, ADR-0008).
 *
 * No thrown strings, no ad-hoc `Error` messages leaking to users. A {@link DomainError}
 * carries a machine `code` (the API maps it to an HTTP status) and an i18n `messageKey`
 * (the UI renders it in the actor's locale — see the i18n catalogue). Structured `params`
 * feed message interpolation; `details` carries developer/diagnostic context (e.g. Zod issues)
 * and is never shown to users.
 */

import type { MessageKey } from "./i18n/keys";

/** Coarse failure category. Drives HTTP status at the API edge. */
export type DomainErrorCode =
  | "validation" // 400 — input failed a schema/invariant check
  | "unauthorized" // 401 — no authenticated actor
  | "forbidden" // 403 — actor lacks the RBAC permission
  | "not_found" // 404 — referenced record does not exist
  | "conflict" // 409 — uniqueness / state conflict
  | "invariant" // 422 — a business rule would be violated
  | "internal"; // 500 — unexpected

export interface DomainError {
  readonly code: DomainErrorCode;
  /** i18n key — the ONLY user-facing text. Typed to the catalogue, so it must exist. */
  readonly messageKey: MessageKey;
  /** Interpolation values for the message template (`{name}` → params.name). */
  readonly params?: Readonly<Record<string, string | number>>;
  /** Diagnostic payload (validation issues, conflicting id…). Not user-facing. */
  readonly details?: unknown;
}

/** Default catalogue key for each code, used when a caller doesn't override it. */
const DEFAULT_KEY: Record<DomainErrorCode, MessageKey> = {
  validation: "error.validation",
  unauthorized: "error.unauthorized",
  forbidden: "error.forbidden",
  not_found: "error.notFound",
  conflict: "error.conflict",
  invariant: "error.invariant",
  internal: "error.internal",
};

/** Options common to every error constructor. */
type ErrorOpts = {
  messageKey?: MessageKey;
  params?: Readonly<Record<string, string | number>>;
  details?: unknown;
};

const make =
  (code: DomainErrorCode) =>
  (opts: ErrorOpts = {}): DomainError => ({
    code,
    messageKey: opts.messageKey ?? DEFAULT_KEY[code],
    params: opts.params,
    details: opts.details,
  });

export const validationError = make("validation");
export const unauthorizedError = make("unauthorized");
export const forbiddenError = make("forbidden");
export const notFoundError = make("not_found");
export const conflictError = make("conflict");
export const invariantError = make("invariant");
export const internalError = make("internal");

/** Type guard — is this value a DomainError? */
export const isDomainError = (value: unknown): value is DomainError =>
  typeof value === "object" && value !== null && "code" in value && "messageKey" in value;
