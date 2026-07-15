/**
 * Audit writer (M0.4, ADR-0011) — the single append-only entry point every mutation calls.
 *
 * Action-log only, per ADR-0011: who ({@link RequestContext.actor}) / what (`action`) / on what
 * (`subjectType` + `subjectId`) / when (the row's `at` default) / from where (`ip` + `userAgent`).
 * **No field-level before/after diffs** — high-risk history is reconstructed from document versions
 * and approval-request records instead. Rows are only ever inserted, never updated or deleted.
 *
 * Takes a Drizzle insert handle rather than importing the ambient `db`, so a mutation can pass its
 * open transaction and have the audit row commit atomically with the change it records — satisfying
 * the Definition-of-Done rule that every mutation writes both its change and its audit entry.
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
 * Append one audit row for `entry`, attributing it to the context's actor (or `null` for a system /
 * unauthenticated action) and stamping its ip / user-agent. Insert-only; awaits the write so a caller
 * inside a transaction fails together with its mutation if the audit write fails.
 */
export const writeAudit = async (
  sink: AuditSink,
  ctx: RequestContext,
  entry: AuditEntry,
): Promise<void> => {
  await sink.insert(auditLog).values({
    actorUserId: ctx.actor?.userId ?? null,
    action: entry.action,
    module: entry.module,
    subjectType: entry.subjectType,
    subjectId: entry.subjectId,
    ip: ctx.ip,
    userAgent: ctx.userAgent,
  });
};
