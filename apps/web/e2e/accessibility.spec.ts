import { expect, test, type Page } from "@playwright/test";
import {
  aliasTermSlugs,
  resolveAlias,
  type AliasCandidate,
  type CuratedEmoji,
} from "@template/core";
import en from "../../../packages/shared/messages/en.json";
import { checkPage, PAGE_RULES, type PageReport } from "./support/axe";
import { seedClaimedHandle } from "./support/seed";

/**
 * Axe over the rendered pages
 * ([#153](https://github.com/joshstothard/3moji/issues/153)): the picker on
 * `/`, a claimed Profile, and an alias listing — in both Playwright projects.
 *
 * Each check asserts three things, as the component check does: **no
 * violations**, **no `incomplete` results**, and that the named rules
 * **actually passed** on that page. The third is what stops a check going
 * green by evaluating nothing, for instance against a page that failed to
 * render its styles or its content.
 */

const builderCopy = en.HandleBuilder;
const handleCopy = en.HandlePage;

function expectAccessible(
  report: PageReport,
  pageRules: readonly string[],
): void {
  expect(report.violations, "axe violations").toEqual([]);
  expect(report.incomplete, "axe incomplete results").toEqual([]);
  expect(report.passed, "rules that ran and passed").toEqual(
    expect.arrayContaining([...PAGE_RULES, ...pageRules]),
  );
}

async function openHome(page: Page): Promise<void> {
  await page.goto("/");
  await expect(
    page.getByRole("searchbox", { name: builderCopy.pickerSearchLabel }),
  ).toBeVisible();
}

test("the home page and its picker have no WCAG A or AA violations", async ({
  page,
}) => {
  await openHome(page);

  expectAccessible(await checkPage(page), ["label", "button-name", "list"]);
});

test("the page check fails when the page has a violation", async ({ page }) => {
  // The check's own proof that it can go red: an unlabelled text input is a
  // WCAG 4.1.2 failure axe reports as `label`. Without this, a helper that
  // silently evaluated nothing would pass every test above and below it.
  await openHome(page);

  // Injected afresh on each attempt, because the node is not React's: on a
  // cold dev server hydration can re-render `<main>` after the heading is
  // visible and drop it, and axe then rightly reports nothing — which is how
  // this test flaked in CI on #174. Retrying never weakens it: it only passes
  // once axe has actually reported `label` for the injected input.
  await expect(async () => {
    await page.evaluate(() => {
      if (document.querySelector("[data-axe-self-test]") !== null) return;
      const input = document.createElement("input");
      input.type = "text";
      input.setAttribute("data-axe-self-test", "");
      document.querySelector("main")?.append(input);
    });

    const report = await checkPage(page);

    expect(report.violations.map((finding) => finding.rule)).toContain("label");
  }).toPass({ timeout: 15_000 });
});

test("a claimed Profile has no WCAG A or AA violations", async ({ page }) => {
  const seeded = await seedClaimedHandle();

  await page.goto(seeded.path);
  await expect(
    page.getByRole("heading", { level: 2, name: seeded.profile.displayName }),
  ).toBeVisible();
  await expect(
    page.getByRole("list", { name: handleCopy.linksLabel }),
  ).toBeVisible();

  expectAccessible(await checkPage(page), ["list", "listitem", "role-img-alt"]);
});

test("an alias listing has no WCAG A or AA violations", async ({ page }) => {
  const { alias, candidates } = aliasNamingSeveralHandles();
  const chooseEmoji = (): readonly CuratedEmoji[] => randomOf(candidates).emoji;

  // Two claimed Handles the one alias names, so the route answers with the
  // listing rather than a single Profile. Each seed tries a fresh random
  // candidate, so the second can never be the first.
  const first = await seedClaimedHandle({ chooseEmoji });
  const second = await seedClaimedHandle({ chooseEmoji });

  await page.goto(`/${alias}`);
  const listing = page.getByRole("list", {
    name: handleCopy.aliasListingLabel,
  });
  await expect(listing).toBeVisible();
  for (const seeded of [first, second]) {
    await expect(listing.locator(`a[href="${seeded.path}"]`)).toHaveCount(1);
  }

  expectAccessible(await checkPage(page), ["list", "listitem", "role-img-alt"]);
});

/**
 * An alias whose one term names more than one emoji, chosen from the domain's
 * own vocabulary rather than hard-coded, so a change to the curated names
 * cannot leave this spec pointing at a word that no longer exists.
 *
 * The term is picked at random, so both Playwright projects and retries spread
 * their seeds across many aliases instead of exhausting one.
 */
function aliasNamingSeveralHandles(): {
  readonly alias: string;
  readonly candidates: readonly AliasCandidate[];
} {
  const eligible = aliasTermSlugs().flatMap((term) => {
    const alias = [term, term, term].join(".");
    const resolution = resolveAlias(alias);
    return resolution.ok && resolution.candidates.length > 1
      ? [{ alias, candidates: resolution.candidates }]
      : [];
  });

  return randomOf(eligible);
}

function randomOf<T>(items: readonly T[]): T {
  const item = items[Math.floor(Math.random() * items.length)];
  if (item === undefined) {
    throw new Error("Nothing to choose from.");
  }
  return item;
}
