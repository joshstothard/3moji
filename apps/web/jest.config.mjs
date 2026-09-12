import base from "@template/jest-config/nextjs";

/** @type {import('jest').Config} */
const config = {
  ...base,
  setupFilesAfterEnv: ["<rootDir>/jest.setup.ts"],
  moduleNameMapper: {
    ...base.moduleNameMapper,
    // `@template/core` itself is mocked per-suite: its root entry point reaches
    // better-auth, which is ESM-only and cannot be `require`d here. The
    // `browser` subpath is pure — emoji data and string functions, asserted by
    // `packages/core/src/browser.test.ts` to reach no infrastructure — so it is
    // mapped to source and runs for real. That matters: the spoken tagline is
    // an acceptance criterion of #78, and a stubbed `spokenHandle` returning a
    // canned string would assert nothing about it.
    "^@template/core/browser$": "<rootDir>/../../packages/core/src/browser.ts",
  },
};

export default config;
