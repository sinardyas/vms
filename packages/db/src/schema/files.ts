import { bigint, pgTable, text, uuid, varchar } from "drizzle-orm/pg-core";
import { timestamps } from "./_shared";
import { users } from "./auth";

// Every uploaded file (compliance doc versions AND bank/terms attachments) → MinIO (ADR-0008/0013).
// Business rows reference a file by id; bytes live in object storage, metadata here.
export const files = pgTable("files", {
  id: uuid().primaryKey().defaultRandom(),
  bucket: varchar({ length: 120 }).notNull(),
  objectKey: text().notNull(),
  mime: varchar({ length: 120 }).notNull(),
  sizeBytes: bigint({ mode: "number" }).notNull(),
  checksum: varchar({ length: 128 }),
  originalName: varchar({ length: 260 }),
  uploadedBy: uuid().references(() => users.id),
  ...timestamps,
});
