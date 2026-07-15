import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/schema/index.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "postgres://vms:vms@localhost:5432/vms",
  },
  casing: "snake_case",
  verbose: true,
  strict: true,
});
