import { randomInt, randomUUID } from "node:crypto";

import { expect, test, type Locator, type Page } from "@playwright/test";
import { canonicalAliasOf, spokenHandle } from "@template/core";
import en from "../../../packages/shared/messages/en.json";
import {
  checkLandmarks,
  checkPage,
  LANDMARK_RULES,
  PAGE_RULES,
} from "./support/axe";
import {
  describeBorderContrast,
  describeContrast,
  measureBorderContrast,
  measureContrast,
} from "./support/contrast";
import { expectNoViolations, watchCspViolations } from "./support/csp";
import { seedClaimedHandle, type SeededHandle } from "./support/seed";

/**
 * The header search, end to end
 * ([ADR-0012](../../../docs/adr/0012-header-search-lists-claimed-handles-with-display-names-capped-and-rate-limited.md),
 * [#254](https://github.com/joshstothard/3moji/issues/254)).
 *
 * In both projects: typing finds a claimed Handle with its display name and
 * canonical alias; the keyboard alone moves through the results, opens one with
 * Enter and closes them with Escape; `/` focuses the search but never takes a
 * slash typed into a field; the open results pass axe; and nothing is refused
 * under the Content Security Policy. On a phone (`Mobile Chrome`) the search
 * opens as a panel from a header button. Over HTTP, in `chromium`: every
 * answer is `private, no-store`, and the 61st request in a window from one
 * client address is a plain `429`.
 *
 * **Every test sends its own random `x-forwarded-for`.** Search is limited to
 * 60 requests per client address per 10 minutes, and against `next dev` that
 * header is client-writable, so without it both projects, every retry and
 * every local re-run would share one bucket.
 *
 * **A seeded Handle is searched by its own three emoji**, which match it
 * exactly, so it is listed first whatever else the shared database holds.
 */

const copy = en.HeaderSearch;

const TEXT_CONTRAST = 4.5;
const NON_TEXT_CONTRAST = 3;

function randomClientAddress(): string {
  return `198.51.${String(randomInt(0, 256))}.${String(randomInt(1, 255))}`;
}

test.beforeEach(async ({ page }) => {
  await page.setExtraHTTPHeaders({ "x-forwarded-for": randomClientAddress() });
});

function combobox(page: Page): Locator {
  return page.getByRole("combobox", { name: copy.label });
}

function opener(page: Page): Locator {
  // Exact: "Close search" contains "Search".
  return page.getByRole("button", { name: copy.open, exact: true });
}

async function seedSearchable(): Promise<SeededHandle> {
  return seedClaimedHandle({
    profile: {
      displayName: `Search E2E ${randomUUID().slice(0, 8)}`,
      bio: "Seeded for the header search spec.",
      links: [],
    },
  });
}

/** Opens `/` and waits for the island to hydrate. */
async function openHome(page: Page, isMobile: boolean): Promise<void> {
  await page.goto("/");
  // The phone's button is rendered only once hydrated; on a wide screen the
  // box is there from the server, so wait for the island's own state instead.
  if (isMobile) {
    await expect(opener(page)).toBeVisible();
  } else {
    await expect(combobox(page)).toHaveAttribute("aria-expanded", "false");
    await expect
      .poll(() =>
        combobox(page).evaluate((element) =>
          Object.keys(element).some((key) => key.startsWith("__reactFiber$")),
        ),
      )
      .toBe(true);
  }
}

async function openSearch(page: Page, isMobile: boolean): Promise<void> {
  if (isMobile) {
    await opener(page).click();
  } else {
    await combobox(page).click();
  }
  await expect(combobox(page)).toBeFocused();
}

function firstOption(page: Page): Locator {
  return page.getByRole("listbox").getByRole("option").first();
}

test("typing a claimed Handle's emoji lists it first, with its display name and canonical alias", async ({
  page,
  isMobile,
}) => {
  const seeded = await seedSearchable();
  await openHome(page, isMobile);
  await openSearch(page, isMobile);

  await combobox(page).fill(seeded.key);

  const first = firstOption(page);
  await expect(first).toContainText(seeded.profile.displayName);
  await expect(first).toContainText(
    canonicalAliasOf(Array.from(seeded.key)) ?? "no alias",
  );
  await expect(first).toHaveAccessibleName(
    new RegExp(spokenHandle(Array.from(seeded.key)) ?? seeded.key),
  );
  await expect(page.getByText(copy.claimedOnly)).toBeVisible();
});

test("the keyboard alone moves through the results, closes them with Escape and opens a Handle with Enter", async ({
  page,
  isMobile,
}) => {
  const seeded = await seedSearchable();
  await openHome(page, isMobile);

  await page.keyboard.press("/");
  await expect(combobox(page)).toBeFocused();
  await expect(combobox(page)).toHaveValue("");

  await page.keyboard.insertText(seeded.key);
  const first = firstOption(page);
  await expect(first).toContainText(seeded.profile.displayName);

  await page.keyboard.press("ArrowDown");
  const id = await first.getAttribute("id");
  await expect(combobox(page)).toHaveAttribute(
    "aria-activedescendant",
    id ?? "no id",
  );
  await expect(first).toHaveAttribute("aria-selected", "true");

  await page.keyboard.press("Escape");
  await expect(page.getByRole("listbox")).toHaveCount(0);
  await expect(combobox(page)).toHaveAttribute("aria-expanded", "false");
  await expect(combobox(page)).toBeFocused();
  await expect(combobox(page)).toHaveValue(seeded.key);

  await page.keyboard.press("ArrowDown");
  await expect(firstOption(page)).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("Enter");

  await expect(page).toHaveURL(new RegExp(`${seeded.path}$`));
  await expect(
    page.getByRole("heading", {
      level: 2,
      name: seeded.profile.displayName,
    }),
  ).toBeVisible();
});

test("/ never takes a slash typed into another field", async ({ page }) => {
  await page.goto("/find");
  const lookup = page.getByRole("searchbox", { name: en.HandleLookup.label });
  await lookup.click();

  await page.keyboard.type("ice/cube");

  await expect(lookup).toHaveValue("ice/cube");
  await expect(lookup).toBeFocused();
});

test("a wide screen shows the search in the header, and a phone opens it as a panel that closes back to its button", async ({
  page,
  isMobile,
}) => {
  await openHome(page, isMobile);

  if (!isMobile) {
    await expect(combobox(page)).toBeVisible();
    await expect(opener(page)).toBeHidden();
    return;
  }

  await expect(combobox(page)).toBeHidden();
  await expect(opener(page)).toHaveAttribute("aria-expanded", "false");

  await opener(page).click();
  await expect(opener(page)).toHaveAttribute("aria-expanded", "true");
  await expect(combobox(page)).toBeVisible();
  await expect(combobox(page)).toBeFocused();

  await page.getByRole("button", { name: copy.close }).click();
  await expect(combobox(page)).toBeHidden();
  await expect(opener(page)).toBeFocused();
});

test("the open results pass axe, and the field and the quieter text meet contrast", async ({
  page,
  isMobile,
}) => {
  const seeded = await seedSearchable();
  await openHome(page, isMobile);
  // Idle on a wide screen, where the field is drawn before it has focus. A
  // phone draws it only once its panel opens, focused.
  const idleBorder = isMobile
    ? undefined
    : await measureBorderContrast(combobox(page));
  await openSearch(page, isMobile);

  const placeholder = await measureContrast(combobox(page), "::placeholder");
  const border = await measureBorderContrast(combobox(page));
  if (idleBorder !== undefined) {
    const account = describeBorderContrast(
      "idle search field border",
      idleBorder,
    );
    console.log(account);
    expect
      .soft(idleBorder.ratio, account)
      .toBeGreaterThanOrEqual(NON_TEXT_CONTRAST);
  }

  await combobox(page).fill(seeded.key);
  const first = firstOption(page);
  await expect(first).toContainText(seeded.profile.displayName);
  const alias = canonicalAliasOf(Array.from(seeded.key)) ?? "no alias";

  const idleAlias = await measureContrast(first.getByText(alias));
  const heading = await measureContrast(
    page.getByText(copy.handlesHeading, { exact: true }),
  );
  const footer = await measureContrast(page.getByText(copy.claimedOnly));
  await page.keyboard.press("ArrowDown");
  await expect(first).toHaveAttribute("aria-selected", "true");
  const activeAlias = await measureContrast(first.getByText(alias));

  const accounts = [
    describeContrast("search placeholder", placeholder),
    describeBorderContrast("search field border", border),
    describeContrast("result alias", idleAlias),
    describeContrast("results heading", heading),
    describeContrast("claimed-only note", footer),
    describeContrast("active result alias", activeAlias),
  ];
  for (const account of accounts) console.log(account);

  expect
    .soft(placeholder.ratio, accounts[0])
    .toBeGreaterThanOrEqual(TEXT_CONTRAST);
  expect
    .soft(border.ratio, accounts[1])
    .toBeGreaterThanOrEqual(NON_TEXT_CONTRAST);
  expect
    .soft(idleAlias.ratio, accounts[2])
    .toBeGreaterThanOrEqual(TEXT_CONTRAST);
  expect.soft(heading.ratio, accounts[3]).toBeGreaterThanOrEqual(TEXT_CONTRAST);
  expect.soft(footer.ratio, accounts[4]).toBeGreaterThanOrEqual(TEXT_CONTRAST);
  expect
    .soft(activeAlias.ratio, accounts[5])
    .toBeGreaterThanOrEqual(TEXT_CONTRAST);

  // The open results overlap the hero, and axe reports the text underneath as
  // `color-contrast` incomplete ("overlapped by another element"). So the open
  // search is checked on its own, with `include`, as an overlay is...
  const open = await checkPage(page, { include: "form[role='search']" });
  expect(open.violations, "axe violations in the open search").toEqual([]);
  expect(open.incomplete, "axe incomplete results in the open search").toEqual(
    [],
  );
  expect(open.passed, "rules that ran and passed in the open search").toEqual(
    expect.arrayContaining([
      "aria-allowed-attr",
      "aria-required-children",
      "aria-required-parent",
      "aria-valid-attr-value",
      "color-contrast",
    ]),
  );

  // ...and the whole page once Escape has closed the results, cleared the box
  // and, on a phone, closed the panel.
  for (let press = 0; press < 3; press += 1) {
    await page.keyboard.press("Escape");
  }
  await expect(page.getByRole("listbox")).toHaveCount(0);
  const report = await checkPage(page);
  expect(report.violations, "axe violations").toEqual([]);
  expect(report.incomplete, "axe incomplete results").toEqual([]);
  expect(report.passed, "rules that ran and passed").toEqual(
    expect.arrayContaining([...PAGE_RULES, "aria-allowed-attr"]),
  );
  const landmarks = await checkLandmarks(page);
  expect(landmarks.violations).toEqual([]);
  expect(landmarks.passed).toEqual(expect.arrayContaining([...LANDMARK_RULES]));
});

test("searching refuses nothing under the Content Security Policy", async ({
  page,
  isMobile,
}) => {
  const watch = await watchCspViolations(page);
  await openHome(page, isMobile);
  await openSearch(page, isMobile);

  await combobox(page).fill("ice");

  await expect(
    page.getByRole("option", { name: /ice cube/i }).first(),
  ).toBeVisible();
  await expectNoViolations(page, watch);
});

test("every answer is private and no-store, and the 61st request in a window from one address is a plain 429", async ({
  request,
  isMobile,
}) => {
  test.skip(isMobile, "requests without a browser: one project is enough");
  const headers = { "x-forwarded-for": randomClientAddress() };

  const answered = await request.get("/api/search?q=ice-cube", { headers });
  expect(answered.status()).toBe(200);
  expect(answered.headers()["cache-control"]).toBe("private, no-store");
  const body: unknown = await answered.json();
  expect(body).toEqual({
    handles: expect.any(Array),
    emoji: expect.any(Array),
  });

  for (let request_ = 2; request_ <= 60; request_ += 1) {
    const response = await request.get("/api/search?q=ice-cube", { headers });
    expect(response.status(), `request ${String(request_)}`).toBe(200);
  }

  const refused = await request.get("/api/search?q=ice-cube", { headers });
  expect(refused.status()).toBe(429);
  expect(await refused.text()).toBe("");
  expect(refused.headers()["retry-after"]).toBeUndefined();
  expect(refused.headers()["cache-control"]).toBe("private, no-store");
});
