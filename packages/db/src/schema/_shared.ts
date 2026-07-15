import { boolean, timestamp } from "drizzle-orm/pg-core";

// Reused column groups. `casing: "snake_case"` (drizzle.config) maps camelCase → snake_case columns.

export const timestamps = {
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
};

/** Master-data soft-enable flag: deactivate hides from NEW captures; never breaks existing refs (ADR-0011). */
export const activeFlag = {
  active: boolean().notNull().default(true),
};
