import { randomInt, randomUUID } from "node:crypto";

import { expect, test, type Page } from "@playwright/test";
import en from "../../../packages/shared/messages/en.json";
import {
  claimCollisionResetPath,
  requestPasswordResetLink,
  seedClaimedHandle,
} from "./support/seed";

/**
 * Password reset, end to end, **with JavaScript switched off**
 * ([#192](https://github.com/joshstothard/3moji/issues/192)).
 *
 * Both forms are plain `<form>`s posting to server actions, so they must work
 * as HTML alone: every test here runs in a context where the page cannot run a
 * script, and a form that needed hydration would never submit.
 *
 * **Each test names its own client.** The request form is limited to
 * `AUTH_RATE_LIMITS.requestPasswordReset` (five an hour) per client address,
 * and the sign-in form to ten in fifteen minutes; against `next dev` every
 * request would otherwise share one bucket across both Playwright projects,
 * every retry and every local re-run. `x-forwarded-for` is client-writable
 * outside Vercel — `docs/architecture/auth.md` records why — so each test sends
 * a random TEST-NET-2 address and never exhausts a neighbour's allowance.
 */

const copy = en.PasswordReset;
const claimCopy = en.Claim;

test.use({ javaScriptEnabled: false });

async function asFreshClient(page: Page): Promise<void> {
  await page.setExtraHTTPHeaders({
    "x-forwarded-for": `198.51.100.${String(randomInt(1, 255))}`,
  });
}

test.beforeEach(async ({ page }) => {
  await asFreshClient(page);
});

test("the claim-collision email's reset link resolves to the request form, not a 404", async ({
  request,
}) => {
  const path = await claimCollisionResetPath();
  expect(path).toBe("/reset-password");

  const response = await request.get(path, { maxRedirects: 0 });

  expect(response.status()).toBe(200);
  expect(await response.text()).toContain(copy.requestHeading);
});

test("the sign-in page links to the request form", async ({ page }) => {
  await page.goto("/sign-in");

  await page.getByRole("link", { name: copy.forgotPasswordLink }).click();

  await expect(page).toHaveURL(/\/reset-password$/);
  await expect(
    page.getByRole("heading", { level: 1, name: copy.requestHeading }),
  ).toBeVisible();
});

test("the request form submits without JavaScript and says the same for a registered and an unregistered address", async ({
  page,
}) => {
  const seeded = await seedClaimedHandle();
  const answers: { url: string; status: string | null }[] = [];

  for (const email of [
    seeded.credentials.email,
    `e2e-${randomUUID()}@example.com`,
  ]) {
    await page.goto("/reset-password");
    await page.getByLabel(copy.emailLabel, { exact: true }).fill(email);
    await page.getByRole("button", { name: copy.requestSubmit }).click();

    await expect(page).toHaveURL(/\/reset-password\?notice=sent$/);
    answers.push({
      url: new URL(page.url()).pathname + new URL(page.url()).search,
      status: await page.getByRole("status").textContent(),
    });
  }

  expect(answers[1]).toEqual(answers[0]);
  expect(answers[0]).toEqual({
    url: "/reset-password?notice=sent",
    status: copy.requestSent,
  });
});

test("the emailed link sets a new password without JavaScript, and the new password signs in", async ({
  page,
}) => {
  const seeded = await seedClaimedHandle();
  const link = await requestPasswordResetLink(seeded.credentials.email);
  const newPassword = `e2e-${randomUUID()}`;

  // The path the email carries: a path segment, never `?token=`.
  expect(link.path).toBe(`/reset-password/${encodeURIComponent(link.token)}`);
  await page.goto(link.path);
  await expect(
    page.getByRole("heading", { level: 1, name: copy.setHeading }),
  ).toBeVisible();
  await page
    .getByLabel(copy.newPasswordLabel, { exact: true })
    .fill(newPassword);
  await page.getByRole("button", { name: copy.setSubmit }).click();

  await expect(page).toHaveURL(/\/sign-in\?notice=password-reset$/);
  await expect(page.getByRole("status")).toHaveText(copy.resetDone);

  await page
    .getByLabel(claimCopy.signInEmailLabel, { exact: true })
    .fill(seeded.credentials.email);
  await page
    .getByLabel(claimCopy.signInPasswordLabel, { exact: true })
    .fill(newPassword);
  await page.getByRole("button", { name: claimCopy.signInSubmit }).click();
  await expect(page).not.toHaveURL(/\/sign-in/);
});

test("an invalid link, and a used one, show one clear message that reveals nothing", async ({
  page,
}) => {
  const seeded = await seedClaimedHandle();
  const link = await requestPasswordResetLink(seeded.credentials.email);
  const pages: { url: string; alert: string | null }[] = [];

  const submitAt = async (path: string): Promise<void> => {
    await page.goto(path);
    await page
      .getByLabel(copy.newPasswordLabel, { exact: true })
      .fill(`e2e-${randomUUID()}`);
    await page.getByRole("button", { name: copy.setSubmit }).click();
  };

  // A token that never existed.
  await submitAt(`/reset-password/${randomUUID().replaceAll("-", "")}`);
  await expect(page).toHaveURL(/\/reset-password\?notice=link-invalid$/);
  pages.push({
    url: new URL(page.url()).search,
    alert: await page.getByRole("alert").textContent(),
  });

  // A real token, used once and then again.
  await submitAt(link.path);
  await expect(page).toHaveURL(/\/sign-in\?notice=password-reset$/);
  await submitAt(link.path);
  await expect(page).toHaveURL(/\/reset-password\?notice=link-invalid$/);
  pages.push({
    url: new URL(page.url()).search,
    alert: await page.getByRole("alert").textContent(),
  });

  expect(pages[1]).toEqual(pages[0]);
  expect(pages[0]).toEqual({
    url: "?notice=link-invalid",
    alert: copy.linkInvalid,
  });
  // The dead token is not left in the address bar, and the request form is
  // right there to ask for a new link.
  expect(page.url()).not.toContain(link.token);
  await expect(page.getByLabel(copy.emailLabel, { exact: true })).toBeVisible();
});
