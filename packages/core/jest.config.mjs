import base from "@template/jest-config/base";

/** @type {import('jest').Config} */
const config = {
  ...base,
  testEnvironment: "node",
  // Integration tests need a real Postgres and run under jest.integration.config.mjs.
  testPathIgnorePatterns: ["/node_modules/", "\\.integration\\.test\\.ts$"],
  // The base preset collects from all of src, which pulls in test files. An
  // integration test that is excluded from this run would otherwise be counted
  // as 0% and drag the whole package under its threshold.
  collectCoverageFrom: ["src/**/*.ts", "!src/**/*.d.ts", "!src/**/*.test.ts"],
};

export default config;
