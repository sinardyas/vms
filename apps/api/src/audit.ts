/**
 * Audit writer (M0.4 / M1.4, ADR-0011) — the single append-only entry point every mutation calls.
 *
 * Action-log only, per ADR-0011: who ({@link AuditAttribution.actorUserId}) / what (`action`) / on
 * what (`subjectType` + `subjectId`) / when (the row's `at` default) / from where (`ip` + `userAgent`).
 * **No field-level before/after diffs** — high-risk history is reconstructed from document versions
 * and approval-request records instead. Rows are only ever inserted, never updated or deleted.
 *
 * Takes a Drizzle insert handle rather than importing the ambient `db`, so a mutation can pass its
 * open transaction and have the audit row commit atomically with the change it records — satisfying
 * the Definition-of-Done rule (M1.4) that every mutation writes both its change and its audit entry.
 *
 * Two entry points share one insert:
 *   - {@link writeAudit} — the request path: pass the whole {@link RequestContext} and it lifts the
 *     actor / ip / user-agent off it. This is what domain mutations (M2+) call inside their tx.
 *   - {@link writeAuditRow} — the low-level path for callers that have no {@link RequestContext} to
 *     hand (e.g. the better-auth session/user hooks), which supply attribution fields directly.
 */

import { type DB, auditLog } from "@vms/db";
import type { RbacModule, RequestContext } from "@vms/domain";

/** Anything that can run a Drizzle insert — the ambient `db` or an open transaction. */
export type AuditSink = Pick<DB, "insert">;

/** One auditable action. `module` scopes it to an RBAC module where one applies (else omit). */
export type AuditEntry = {
  /** Dotted action code, e.g. `vendor.submitted`, `document.verified`, `role.updated`. */
  readonly action: string;
  readonly module?: RbacModule;
  /** The kind of thing acted on, e.g. `vendor` | `approval_request` | `role`. */
  readonly subjectType: string;
  readonly subjectId?: string;
};

/**
 * Who/where an audit row is attributed to, independent of the request plumbing. `actorUserId` is
 * `null` for a system or unauthenticated action (no `userId`); `ip` / `userAgent` may be absent.
 */
export type AuditAttribution = {
  readonly actorUserId: string | null;
  readonly ip?: string;
  readonly userAgent?: string;
};

/** Lift the audit attribution off a {@link RequestContext} — actor id (or null) plus ip / user-agent. */
export const attributionOf = (ctx: RequestContext): AuditAttribution => ({
  actorUserId: ctx.actor?.userId ?? null,
  ip: ctx.ip,
  userAgent: ctx.userAgent,
});

/**
 * Append one audit row for `entry` with explicit `attribution`. Insert-only; awaits the write so a
 * caller inside a transaction fails together with its mutation if the audit write fails.
 */
export const writeAuditRow = async (
  sink: AuditSink,
  attribution: AuditAttribution,
  entry: AuditEntry,
): Promise<void> => {
  await sink.insert(auditLog).values({
    actorUserId: attribution.actorUserId,
    action: entry.action,
    module: entry.module,
    subjectType: entry.subjectType,
    subjectId: entry.subjectId,
    ip: attribution.ip,
    userAgent: attribution.userAgent,
  });
};

/**
 * Append one audit row for `entry`, attributing it to the request context's actor (or `null` for a
 * system / unauthenticated action) and stamping its ip / user-agent. The convenience wrapper domain
 * mutations use inside their transaction — see {@link writeAuditRow} for the low-level form.
 */
export const writeAudit = (
  sink: AuditSink,
  ctx: RequestContext,
  entry: AuditEntry,
): Promise<void> => writeAuditRow(sink, attributionOf(ctx), entry);
