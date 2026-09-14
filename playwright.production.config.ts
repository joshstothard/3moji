import { defineConfig, devices } from "@playwright/test";

/**
 * The production Content Security Policy smoke test
 * ([#205](https://github.com/joshstothard/3moji/issues/205)).
 *
 * `playwright.config.ts` runs every spec against `next dev`, which sends the
 * development policy (`'unsafe-eval'`, inline styles). This runs the one file
 * that proves the production policy, against `next start` on an existing
 * `next build`, on a port of its own so it never meets a dev server on 3000.
 *
 * Run it after a build: `npm run build && npm run test:e2e:production`. It
 * needs the same environment as the E2E job (a migrated database and the five
 * variables `lib/services.ts` requires); CI's E2E job runs it as a step after
 * the main suite.
 */
const PORT = Number(process.env["PRODUCTION_SMOKE_PORT"] ?? "3107");
const ORIGIN = `http://localhost:${String(PORT)}`;

/**
 * The E2E job's environment, for a production server. `TEST_EMAIL_SENDER` and
 * `TEST_ERROR_ROUTE` are dropped because production refuses the first and
 * ignores the second, and the auth base URL follows the port.
 */
const serverEnv: Record<string, string> = {
  ...Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] =>
        entry[1] !== undefined &&
        entry[0] !== "TEST_EMAIL_SENDER" &&
        entry[0] !== "TEST_ERROR_ROUTE",
    ),
  ),
  NODE_ENV: "production",
  BETTER_AUTH_URL: ORIGIN,
};

export default defineConfig({
  testDir: "./apps/web/e2e",
  testMatch: "content-security-policy.production.ts",
  forbidOnly: !!process.env["CI"],
  retries: process.env["CI"] ? 2 : 0,
  workers: 1,
  reporter: process.env["CI"]
    ? [
        ["list"],
        [
          "html",
          { open: "never", outputFolder: "playwright-report-production" },
        ],
      ]
    : [
        [
          "html",
          { open: "never", outputFolder: "playwright-report-production" },
        ],
      ],
  use: {
    baseURL: ORIGIN,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `npm run start --workspace @template/web -- --port ${String(PORT)}`,
    url: ORIGIN,
    env: serverEnv,
    reuseExistingServer: !process.env["CI"],
  },
});
