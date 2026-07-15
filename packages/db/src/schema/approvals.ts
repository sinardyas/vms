import { sql } from "drizzle-orm";
import {
  boolean,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { timestamps } from "./_shared";
import { approvalStatusEnum, approvalTriggerEnum, stepDecisionEnum } from "./enums";
import { users } from "./auth";
import { approvalRoutes } from "./master-data";
import { roles } from "./rbac";
import { vendors } from "./vendors";

// Generalized workflow spine (ADR-0005). One aggregate for registration + edits + reactivation.
export const approvalRequests = pgTable(
  "approval_requests",
  {
    id: uuid().primaryKey().defaultRandom(),
    subjectVendorId: uuid()
      .notNull()
      .references(() => vendors.id, { onDelete: "cascade" }),
    trigger: approvalTriggerEnum().notNull(),
    status: approvalStatusEnum().notNull().default("pending"),
    // For edits: the proposed diff (applied only on final approval). For registration: the draft snapshot.
    payload: jsonb().$type<Record<string, unknown>>(),
    routeId: uuid()
      .notNull()
      .references(() => approvalRoutes.id),
    currentStepNo: integer().notNull().default(1),
    submittedBy: uuid().references(() => users.id),
    resolvedAt: timestamp({ withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    // One pending change at a time per vendor (ADR-0010).
    uniqueIndex("approval_requests_one_pending_per_vendor_uq")
      .on(t.subjectVendorId)
      .where(sql`status = 'pending'`),
  ],
);

// Ordered steps, each with a named assignee (auto → role lead, delegable — ADR-0012).
// A step decision requires the route ROLE and the module 'approve' permission, minus SoD (ADR-0011/0014).
export const approvalRequestSteps = pgTable(
  "approval_request_steps",
  {
    id: uuid().primaryKey().defaultRandom(),
    requestId: uuid()
      .notNull()
      .references(() => approvalRequests.id, { onDelete: "cascade" }),
    stepNo: integer().notNull(),
    roleId: uuid()
      .notNull()
      .references(() => roles.id),
    assigneeUserId: uuid().references(() => users.id),
    decision: stepDecisionEnum().notNull().default("pending"),
    decidedBy: uuid().references(() => users.id),
    reason: text(),
    decidedAt: timestamp({ withTimezone: true }),
    isOverride: boolean().notNull().default(false), // zero-eligible-approver escalation (ADR-0014)
    reassignedFrom: uuid().references(() => users.id),
    note: varchar({ length: 300 }),
    ...timestamps,
  },
  (t) => [uniqueIndex("approval_request_steps_uq").on(t.requestId, t.stepNo)],
);
