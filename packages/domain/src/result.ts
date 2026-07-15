/**
 * Result / error conventions (M0.3, ADR-0008).
 *
 * Domain functions never throw for expected failures and never return bare strings.
 * They return a `Result<T, E>`: an explicit success (`ok`) or a typed failure (`err`).
 * `E` defaults to {@link DomainError} so callers get an i18n-keyed, code-tagged error.
 *
 * This is the contract every later domain function (RBAC `can()`, the M4 engine, the
 * M3 validators) builds on — the API maps `err` → HTTP status via `error.code`, and the
 * UI renders `error.messageKey` through the i18n catalogue.
 */

import type { DomainError } from "./errors";

export type Ok<T> = { readonly ok: true; readonly value: T };
export type Err<E> = { readonly ok: false; readonly error: E };

/** Either a success carrying `T`, or a failure carrying `E` (a {@link DomainError} by default). */
export type Result<T, E = DomainError> = Ok<T> | Err<E>;

/** Wrap a success value. */
export const ok = <T>(value: T): Ok<T> => ({ ok: true, value });

/** Wrap a failure. */
export const err = <E>(error: E): Err<E> => ({ ok: false, error });

/** Narrowing guard: is this Result a success? */
export const isOk = <T, E>(r: Result<T, E>): r is Ok<T> => r.ok;

/** Narrowing guard: is this Result a failure? */
export const isErr = <T, E>(r: Result<T, E>): r is Err<E> => !r.ok;

/** Transform the success value, leaving a failure untouched. */
export const map = <T, U, E>(r: Result<T, E>, fn: (value: T) => U): Result<U, E> =>
  r.ok ? ok(fn(r.value)) : r;

/** Transform the error, leaving a success untouched. */
export const mapErr = <T, E, F>(r: Result<T, E>, fn: (error: E) => F): Result<T, F> =>
  r.ok ? r : err(fn(r.error));

/** Extract the success value, or fall back to `fallback` on failure. */
export const unwrapOr = <T, E>(r: Result<T, E>, fallback: T): T => (r.ok ? r.value : fallback);
