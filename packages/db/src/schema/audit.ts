import { index, pgTable, text, timestamp, uuid, varchar } from "drizzle-orm/pg-core";
import { rbacModuleEnum } from "./enums";
import { users } from "./auth";

// Action-log only — who / action / subject / when / where (ADR-0011). No field-level diffs.
// Append-only: rows are never updated or deleted.
export const auditLog = pgTable(
  "audit_log",
  {
    id: uuid().primaryKey().defaultRandom(),
    actorUserId: uuid().references(() => users.id), // null for system actions
    action: varchar({ length: 120 }).notNull(), // e.g. 'vendor.submitted', 'document.verified', 'role.updated'
    module: rbacModuleEnum(),
    subjectType: varchar({ length: 60 }).notNull(), // 'vendor' | 'approval_request' | 'role' | …
    subjectId: uuid(),
    at: timestamp({ withTimezone: true }).notNull().defaultNow(),
    ip: varchar({ length: 64 }),
    userAgent: text(),
  },
  (t) => [
    index("audit_log_subject_idx").on(t.subjectType, t.subjectId),
    index("audit_log_at_idx").on(t.at),
    // Supports the M1.4 viewer's "by actor" filter (and the users join it drives).
    index("audit_log_actor_idx").on(t.actorUserId),
  ],
);
