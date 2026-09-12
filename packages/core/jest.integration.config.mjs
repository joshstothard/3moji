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
};

export default config;
