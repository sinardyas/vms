import { jsonb, pgTable, text, timestamp, uuid, varchar } from "drizzle-orm/pg-core";
import { timestamps } from "./_shared";
import { notificationChannelEnum } from "./enums";
import { users } from "./auth";

// Notification events (ADR-0012). Vendors → email; internal users → in-app + email.
// Content is localized at send time from an i18n key + params (ADR-0008).
export const notifications = pgTable("notifications", {
  id: uuid().primaryKey().defaultRandom(),
  userId: uuid()
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  event: varchar({ length: 60 }).notNull(), // 'email_verify' | 'decision' | 'doc_rejected' | 'step_assigned' | 'office_invite'
  channel: notificationChannelEnum().notNull(),
  titleKey: varchar({ length: 120 }).notNull(),
  bodyKey: varchar({ length: 120 }),
  params: jsonb().$type<Record<string, unknown>>(),
  link: text(),
  readAt: timestamp({ withTimezone: true }),
  ...timestamps,
});
