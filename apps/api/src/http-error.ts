/**
 * DomainError → HTTP mapping at the API edge (M0.4).
 *
 * The one place a typed {@link DomainError} becomes an HTTP response: `error.code` picks the
 * status, and `error.messageKey` is resolved through the i18n catalogue in the *request's* locale
 * (from the {@link RequestContext} the context middleware set). The machine `code` and `messageKey`
 * ride along in the body so clients can branch or re-localise without parsing prose.
 */

import { type DomainError, type DomainErrorCode, type Locale, translate } from "@vms/domain";
import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { AppEnv } from "./context";

/** Coarse failure category → HTTP status (mirrors the codes documented in `@vms/domain`'s errors). */
const STATUS: Record<DomainErrorCode, ContentfulStatusCode> = {
  validation: 400,
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  invariant: 422,
  internal: 500,
};

/** The JSON envelope for a failed request — machine `code` + localized `message` + raw `messageKey`. */
export const errorBody = (error: DomainError, locale: Locale) => ({
  error: {
    code: error.code,
    message: translate(error.messageKey, locale),
    messageKey: error.messageKey,
    ...(error.params ? { params: error.params } : {}),
  },
});

/** Write a {@link DomainError} as the HTTP response, localized to the request context's locale. */
export const sendError = (c: Context<AppEnv>, error: DomainError) =>
  c.json(errorBody(error, c.var.ctx?.locale ?? "id"), STATUS[error.code]);
