import { boolean, pgTable, text, timestamp, uniqueIndex, uuid, varchar } from "drizzle-orm/pg-core";
import { userKindEnum } from "./enums";

// Identity (ADR-0004). One users table with a `kind`; credentials/sessions via better-auth
// companion tables (ADR-0015). Portal vs Console authorization is by RBAC, not separate stacks.

export const users = pgTable(
  "users",
  {
    id: uuid().primaryKey().defaultRandom(),
    kind: userKindEnum().notNull(),
    email: varchar({ length: 320 }).notNull(),
    emailVerified: boolean().notNull().default(false),
    name: varchar({ length: 200 }).notNull(),
    image: text(),
    active: boolean().notNull().default(true),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("users_email_uq").on(t.email)],
);

export const authSessions = pgTable(
  "auth_sessions",
  {
    id: uuid().primaryKey().defaultRandom(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    token: text().notNull(),
    expiresAt: timestamp({ withTimezone: true }).notNull(),
    ipAddress: varchar({ length: 64 }),
    userAgent: text(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("auth_sessions_token_uq").on(t.token)],
);

// better-auth stores the password hash for email/password on the account row.
export const authAccounts = pgTable("auth_accounts", {
  id: uuid().primaryKey().defaultRandom(),
  userId: uuid()
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  providerId: varchar({ length: 64 }).notNull(), // 'credential' | 'sso' | …
  accountId: varchar({ length: 320 }).notNull(),
  passwordHash: text(),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
});

// Email-verification / password-reset tokens (ADR-0004 email-first).
// better-auth's `verification` model requires both createdAt and updatedAt (M1.1, #20).
export const authVerifications = pgTable("auth_verifications", {
  id: uuid().primaryKey().defaultRandom(),
  identifier: varchar({ length: 320 }).notNull(),
  value: text().notNull(),
  expiresAt: timestamp({ withTimezone: true }).notNull(),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
});
