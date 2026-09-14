import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./apps/web/e2e",
  fullyParallel: true,
  forbidOnly: !!process.env["CI"],
  retries: process.env["CI"] ? 2 : 0,
  workers: process.env["CI"] ? 1 : undefined,
  // In CI the list reporter names every spec in the job log, which is where a
  // run is proved; the html report is still uploaded as an artifact (#153).
  reporter: process.env["CI"]
    ? [["list"], ["html", { open: "never" }]]
    : "html",
  use: {
    baseURL: process.env["BASE_URL"] ?? "http://localhost:3000",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "Mobile Chrome",
      use: { ...devices["Pixel 7"] },
    },
  ],
  webServer: {
    // The server's output is written to `e2e-server.log` (git-ignored by
    // `*.log`), so `request-error-log.spec.ts` can assert on the structured
    // lines the app writes (#203). The pipe sends it all to stdout, which
    // Playwright discards, and **it must stay discarded**: `next dev` prints
    // every request's URL, and `password-reset.spec.ts` opens a reset link whose
    // token is in the path, which in this public repository's Actions log would
    // be a live credential. For the same reason, never upload the file as an
    // artifact.
    command: "npm run dev 2>&1 | tee e2e-server.log",
    url: "http://localhost:3000",
    reuseExistingServer: !process.env["CI"],
  },
});
