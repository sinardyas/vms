import { isNull } from "drizzle-orm";
import { index, jsonb, pgTable, text, timestamp, uuid, varchar } from "drizzle-orm/pg-core";
import { timestamps } from "./_shared";
import { notificationChannelEnum } from "./enums";
import { users } from "./auth";

// Notification events (ADR-0012). Vendors → email; internal users → in-app + email.
// Content is localized at send time from an i18n key + params (ADR-0008).
//
// Rows are the *in-app* half of the store (M6.1) — the source the M6.3 notification centre reads.
// Only what a template needs is persisted (`titleKey` + `bodyKey` + `params`), never rendered copy:
// a row written for an Indonesian reader must re-render in English if they switch locale, so the
// language is resolved at read time, not frozen at write time (ADR-0008).
export const notifications = pgTable(
  "notifications",
  {
    id: uuid().primaryKey().defaultRandom(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    event: varchar({ length: 60 }).notNull(), // NotificationEvent — see @vms/domain NOTIFICATION_EVENTS
    channel: notificationChannelEnum().notNull(),
    titleKey: varchar({ length: 120 }).notNull(),
    bodyKey: varchar({ length: 120 }),
    params: jsonb().$type<Record<string, unknown>>(),
    link: text(),
    readAt: timestamp({ withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    // The centre's feed: one user's notifications, newest first (M6.3).
    index("notifications_user_created_idx").on(t.userId, t.createdAt.desc()),
    // The bell's unread badge. Partial, because read rows accumulate without bound while the unread
    // set stays small — so the count stays proportional to what's outstanding, not to all history.
    index("notifications_user_unread_idx")
      .on(t.userId)
      .where(isNull(t.readAt)),
  ],
);
