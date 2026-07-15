import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

export * as schema from "./schema";
export * from "./schema";

const connectionString = process.env.DATABASE_URL ?? "postgres://vms:vms@localhost:5432/vms";

// One shared client. `casing: "snake_case"` maps camelCase columns → snake_case (see drizzle.config).
const queryClient = postgres(connectionString, { max: 10 });

export const db = drizzle(queryClient, { schema, casing: "snake_case" });
export type DB = typeof db;
