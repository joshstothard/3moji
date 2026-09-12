import base from "@template/jest-config/base";

/**
 * Integration tests: real Postgres, no mocks. CI's `integration-tests` job
 * provides a `postgres:16` service and sets DATABASE_URL. There is deliberately
 * no coverage threshold here — coverage is the unit suite's job.
 */
const { coverageThreshold: _unused, ...rest } = base;

/** @type {import('jest').Config} */
const config = {
  ...rest,
  testEnvironment: "node",
  testMatch: ["**/*.integration.test.ts"],
  testTimeout: 30_000,
  /**
   * One worker, because every suite here shares the one database and each runs
   * Drizzle's migrator. Two workers against a fresh database both read "nothing
   * applied" and both issue the same `CREATE TABLE`, so one dies with
   * `42P07 duplicate_table` — a flake that only appears on a clean database,
   * which is exactly where CI runs. Concurrency inside a test is unaffected:
   * `handle.integration.test.ts` races two connections it checks out itself.
   */
  maxWorkers: 1,
};

export default config;
