import { expect, test, type Page } from "@playwright/test";

import en from "../../../packages/shared/messages/en.json";
import { seedClaimedHandle } from "./support/seed";

/**
 * The footer on every page, in the real app
 * ([#198](https://github.com/joshstothard/3moji/issues/198)).
 *
 * `footer.test.tsx` proves what the footer renders. This proves the root
 * layout puts it on the pages people actually reach, static and dynamic alike,
 * and that it does not make a public Profile vary by viewer. Its axe and
 * contrast checks are in `accessibility.spec.ts`, its keyboard journey in
 * `keyboard-only.spec.ts`.
 */

const copy = en.Footer;
const LICENCE_URL = "https://creativecommons.org/licenses/by/4.0/";

/** The placeholder CI's E2E job sets. Never a real mailbox. */
function configuredAddress(): string {
  const value = process.env.REPORT_CONTACT_EMAIL;
  if (value === undefined || value === "") {
    throw new Error(
      "REPORT_CONTACT_EMAIL is not set; see the e2e job in .github/workflows/ci.yml.",
    );
  }
  return value;
}

async function expectFooterLinks(page: Page): Promise<void> {
  const footer = page.getByRole("contentinfo");
  const nav = footer.getByRole("navigation", { name: copy.legalNavLabel });

  await expect(nav.getByRole("link", { name: copy.privacy })).toHaveAttribute(
    "href",
    "/privacy",
  );
  await expect(nav.getByRole("link", { name: copy.terms })).toHaveAttribute(
    "href",
    "/terms",
  );
  await expect(nav.getByRole("link", { name: copy.report })).toHaveAttribute(
    "href",
    `mailto:${configuredAddress()}?subject=${encodeURIComponent(
      copy.reportSubject,
    )}&body=${encodeURIComponent(copy.reportBody)}`,
  );
  await expect(
    footer.getByRole("link", { name: copy.emojiCreditLicence }),
  ).toHaveAttribute("href", LICENCE_URL);
}

for (const path of [
  "/",
  "/privacy",
  "/terms",
  "/sign-in",
  "/reset-password",
  "/claim/held",
]) {
  test(`the footer on ${path} links privacy, terms, reporting and the licence`, async ({
    page,
  }) => {
    const response = await page.goto(path);
    expect(response?.status()).toBe(200);

    await expectFooterLinks(page);
  });
}

test("the footer on a claimed Profile links privacy, terms, reporting and the licence", async ({
  page,
}) => {
  const seeded = await seedClaimedHandle();

  await page.goto(seeded.path);

  await expectFooterLinks(page);
});

test("the footer's privacy and terms links reach their pages", async ({
  page,
}) => {
  await page.goto("/");
  const nav = page
    .getByRole("contentinfo")
    .getByRole("navigation", { name: copy.legalNavLabel });

  await nav.getByRole("link", { name: copy.privacy }).click();
  await expect(page).toHaveURL("/privacy");
  await expect(
    page.getByRole("heading", { level: 1, name: en.Legal.Privacy.heading }),
  ).toBeVisible();

  await nav.getByRole("link", { name: copy.terms }).click();
  await expect(page).toHaveURL("/terms");
  await expect(
    page.getByRole("heading", { level: 1, name: en.Legal.Terms.heading }),
  ).toBeVisible();
});

/** The rendered `<footer>` element, as served. */
function footerIn(html: string): string | undefined {
  return /<footer\b[\s\S]*?<\/footer>/.exec(html)?.[0];
}

test("the footer does not make a Profile vary by viewer", async ({
  request,
}) => {
  const seeded = await seedClaimedHandle();

  const anonymous = await request.get(seeded.path, { maxRedirects: 0 });
  const withCookie = await request.get(seeded.path, {
    maxRedirects: 0,
    headers: { cookie: "better-auth.session_token=not-a-real-session" },
  });

  expect(anonymous.status()).toBe(200);
  expect(withCookie.status()).toBe(200);
  const footer = footerIn(await anonymous.text());
  expect(footer).toContain(copy.privacy);
  expect(footerIn(await withCookie.text())).toBe(footer);
  expect(anonymous.headers().vary ?? "").not.toMatch(/cookie/i);
});
