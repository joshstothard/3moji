import { defineConfig } from "drizzle-kit";

/**
 * Migrations are generated from the schema and committed, never applied by hand
 * (repo Absolute Rule 4). `drizzle-kit generate` needs no database; only
 * `migrate` connects, and it uses the **unpooled** connection because a pooled
 * one cannot hold the advisory lock a migration needs (ADR-0006 decision 6).
 */
export default defineConfig({
  // Every module holding a table, listed explicitly. `schema.ts` is Better
  // Auth's four tables; `handle.ts` is the first table we design ourselves. A
  // glob would sweep the `*.test.ts` files beside them in, so new tables are
  // added here by hand — a table missing from this list generates no migration
  // and fails no build.
  schema: ["./src/db/schema.ts", "./src/db/handle.ts"],
  out: "./migrations",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL ?? "",
  },
  strict: true,
  verbose: true,
});
