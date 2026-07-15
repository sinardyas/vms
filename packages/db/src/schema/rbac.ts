import { boolean, pgTable, timestamp, uniqueIndex, uuid, varchar } from "drizzle-orm/pg-core";
import { rbacModuleEnum } from "./enums";
import { users } from "./auth";
import { departments } from "./master-data";

// RBAC (ADR-0011, 0012). Approval authority = route role AND module approve-permission.
// Roles carry a designated lead for auto-dispatch (ADR-0012).

export const roles = pgTable("roles", {
  id: uuid().primaryKey().defaultRandom(),
  nameId: varchar({ length: 160 }).notNull(),
  nameEn: varchar({ length: 160 }).notNull(),
  departmentId: uuid().references(() => departments.id),
  // Step auto-assigns to this lead, who keeps or delegates (ADR-0012).
  leadUserId: uuid().references(() => users.id),
  active: boolean().notNull().default(true),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
});

// One row per (role, module): the 9-module × 5-verb matrix (ADR-0011/0012).
// Seeds must keep this consistent with approval routes → deadlock guard (ADR-0011).
export const rolePermissions = pgTable(
  "role_permissions",
  {
    id: uuid().primaryKey().defaultRandom(),
    roleId: uuid()
      .notNull()
      .references(() => roles.id, { onDelete: "cascade" }),
    module: rbacModuleEnum().notNull(),
    canAdd: boolean().notNull().default(false),
    canEdit: boolean().notNull().default(false),
    canDelete: boolean().notNull().default(false),
    canView: boolean().notNull().default(false),
    canApprove: boolean().notNull().default(false),
  },
  (t) => [uniqueIndex("role_permissions_role_module_uq").on(t.roleId, t.module)],
);

export const userRoles = pgTable(
  "user_roles",
  {
    id: uuid().primaryKey().defaultRandom(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    roleId: uuid()
      .notNull()
      .references(() => roles.id, { onDelete: "cascade" }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("user_roles_user_role_uq").on(t.userId, t.roleId)],
);
