import { defineConfig } from "drizzle-kit";

/**
 * Migrations are generated from the schema and committed, never applied by hand
 * (repo Absolute Rule 4). `drizzle-kit generate` needs no database; only
 * `migrate` connects, and it uses the **unpooled** connection because a pooled
 * one cannot hold the advisory lock a migration needs (ADR-0006 decision 6).
 */
export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./migrations",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL ?? "",
  },
  strict: true,
  verbose: true,
});
