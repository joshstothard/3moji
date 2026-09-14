import { expect, test } from "@playwright/test";
import en from "../../../packages/shared/messages/en.json";
import { checkPage } from "./support/axe";
import {
  directiveOf,
  expectHydrated,
  expectNoncedHtml,
  expectNoViolations,
  watchCspViolations,
} from "./support/csp";
import { pickEmojiByName } from "./support/picker";
import { seedClaimedHandle } from "./support/seed";

/**
 * The production Content Security Policy, against a production build
 * ([#205](https://github.com/joshstothard/3moji/issues/205)).
 *
 * Run by `playwright.production.config.ts` (`npm run test:e2e:production`),
 * never by the main suite, which runs `next dev` and so the development policy.
 * What only a production build can show is here: the strict policy on the wire,
 * and pages that would have been prerendered — `/` and the 404 — carrying a
 * nonce on every script and hydrating under it. Built without
 * `export const dynamic` in `app/layout.tsx`, `/` has twelve scripts and no
 * nonce, and every assertion below about it fails.
 */

const builderCopy = en.HandleBuilder;
const notFoundCopy = en.NotFoundPage;

test("the production policy allows no eval and no inline script or style", async ({
  request,
}) => {
  const response = await request.get("/");
  const policy = response.headers()["content-security-policy"];

  const scripts = directiveOf(policy, "script-src") ?? [];
  const styles = directiveOf(policy, "style-src") ?? [];
  expect(scripts).toContain("'strict-dynamic'");
  expect(scripts.some((source) => source.startsWith("'nonce-"))).toBe(true);
  expect(scripts).not.toContain("'unsafe-eval'");
  expect(scripts).not.toContain("'unsafe-inline'");
  expect(styles.some((source) => source.startsWith("'nonce-"))).toBe(true);
  expect(styles).not.toContain("'unsafe-inline'");
  expect(directiveOf(policy, "frame-ancestors")).toEqual(["'none'"]);
  expect(directiveOf(policy, "form-action")).toEqual(["'self'"]);
  expect(directiveOf(policy, "upgrade-insecure-requests")).toBeUndefined();
});

test("/ is rendered per request, hydrates, runs the builder and passes axe, with nothing refused", async ({
  page,
}) => {
  const watch = await watchCspViolations(page);

  await expectNoncedHtml(await page.goto("/"));
  await expectHydrated(page);
  // 🧊🧊🧊 is available (rare-handle.spec.ts), so the availability server
  // action answers and the celebration sets its inline animation delay.
  // The picker has no search box since #253: open the tab, press the emoji.
  for (let picked = 0; picked < 3; picked += 1) {
    await pickEmojiByName(page, "ice cube");
  }
  await expect(
    page.getByText(builderCopy.rareBadge, { exact: true }),
  ).toBeVisible();

  // axe is injected over the DevTools protocol, so the policy does not stop it.
  const report = await checkPage(page);
  expect(report.violations).toEqual([]);

  await expectNoViolations(page, watch);
});

test("a Profile hydrates under the production policy with nothing refused", async ({
  page,
}) => {
  const seeded = await seedClaimedHandle();
  const watch = await watchCspViolations(page);

  await expectNoncedHtml(await page.goto(seeded.path));
  await expect(
    page.getByRole("heading", { level: 2, name: seeded.profile.displayName }),
  ).toBeVisible();
  await expectHydrated(page);

  await expectNoViolations(page, watch);
});

test("the 404 is still a 404, and hydrates with nothing refused", async ({
  page,
}) => {
  const watch = await watchCspViolations(page);

  const response = await page.goto("/no/such/page");

  expect(response?.status()).toBe(404);
  await expectNoncedHtml(response);
  await expect(
    page.getByRole("heading", { level: 1, name: notFoundCopy.heading }),
  ).toBeVisible();
  await expectHydrated(page);
  await expectNoViolations(page, watch);
});
