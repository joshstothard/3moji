import { expect, test, type Page } from "@playwright/test";

import en from "../../../packages/shared/messages/en.json";
import { TEST_ERROR_MESSAGE } from "../src/lib/test-error-route";

/**
 * The branded not-found and error pages, on the wire
 * ([#203](https://github.com/joshstothard/3moji/issues/203)).
 *
 * `not-found.test.tsx` and `error.test.tsx` prove what each page renders. This
 * proves the real app serves them with the right status and inside the layout,
 * and that no route's existing answer changed: a reserved Handle still
 * resolves. Their axe and contrast checks are in `accessibility.spec.ts`.
 *
 * Every 404 offers the Find a Handle lookup, empty
 * ([#201](https://github.com/joshstothard/3moji/issues/201)). The spoken path
 * `/three-ice-cubes` stays a 404 under ADR-0008; `find-a-handle.spec.ts` proves
 * the words typed into the lookup from there reach the Handle.
 *
 * The error page comes from `/test-only-error`, which throws only because CI's
 * E2E job sets `TEST_ERROR_ROUTE=enabled` (`lib/test-error-route.ts`).
 */
const notFoundCopy = en.NotFoundPage;
const lookupCopy = en.HandleLookup;
const errorCopy = en.ErrorPage;

/** 🍕 U+1F355 — the platform-owned demo Handle in `RESERVED_HANDLE_ENTRIES`. */
const PIZZA = "%F0%9F%8D%95";

async function expectLayout(page: Page): Promise<void> {
  // The navbar is the first navigation landmark; the footer is `contentinfo`.
  await expect(page.getByRole("navigation").first()).toBeVisible();
  await expect(page.getByRole("contentinfo")).toBeVisible();
}

/**
 * Each path and the title it carries. An unmatched path takes this page's
 * title; a `notFound()` from `[handle]` keeps the site's generic title, which
 * that route's `generateMetadata` gives every answer it cannot attribute to one
 * Handle (system-overview.md § A Profile's Open Graph card).
 */
for (const [name, path, title] of [
  ["an unknown path", "/no/such/page", notFoundCopy.metaTitle],
  ["a segment that is not a Handle", "/abc", "3moji"],
  ["a word that names no Handle", "/not-a-word-of-ours", "3moji"],
  ["the spoken form of a Handle (#201)", "/three-ice-cubes", "3moji"],
] as const) {
  test(`${name} gets the branded 404, inside the layout, with status 404`, async ({
    page,
  }) => {
    const response = await page.goto(path);

    expect(response?.status()).toBe(404);
    await expect(
      page.getByRole("heading", { level: 1, name: notFoundCopy.heading }),
    ).toBeVisible();
    await expect(page).toHaveTitle(title);
    await expectLayout(page);

    // The lookup, empty: the page reads nothing from the request (#201).
    await expect(
      page.getByRole("search", { name: lookupCopy.heading }),
    ).toHaveCount(1);
    await expect(
      page.getByRole("searchbox", { name: lookupCopy.label }),
    ).toHaveValue("");

    await page
      .getByRole("main")
      .getByRole("link", { name: notFoundCopy.home })
      .click();
    await expect(page).toHaveURL("/");
  });
}

test("a reserved Handle still says reserved, with status 200, and never the 404", async ({
  page,
}) => {
  const response = await page.goto(`/${PIZZA}${PIZZA}${PIZZA}`);

  expect(response?.status()).toBe(200);
  await expect(
    page.getByText(en.HandlePage.stateNotClaimable, { exact: true }),
  ).toBeVisible();
  await expect(page.getByText(notFoundCopy.heading)).toHaveCount(0);
});

test("an unexpected server error gets the branded error page, with a retry and a way home", async ({
  page,
}) => {
  const response = await page.goto("/test-only-error");

  expect(response?.status()).toBe(500);
  const main = page.getByRole("main");
  await expect(
    main.getByRole("heading", { level: 1, name: errorCopy.heading }),
  ).toBeVisible();
  await expect(
    main.getByRole("button", { name: errorCopy.retry }),
  ).toBeVisible();
  await expect(
    main.getByRole("link", { name: errorCopy.home }),
  ).toHaveAttribute("href", "/");
  await expectLayout(page);
});

test("the error page reveals no message, digest or stack trace", async ({
  page,
}) => {
  await page.goto("/test-only-error");
  await expect(
    page.getByRole("heading", { level: 1, name: errorCopy.heading }),
  ).toBeVisible();

  const shown = await page.locator("body").innerText();

  expect(shown).not.toContain(TEST_ERROR_MESSAGE);
  expect(shown.toLowerCase()).not.toContain("digest");
  expect(shown).not.toMatch(/\bat \S+ \(/);
  expect(shown).not.toContain("page.tsx");
});
