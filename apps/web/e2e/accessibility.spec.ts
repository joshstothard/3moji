import { expect, test, type Page } from "@playwright/test";
import {
  aliasTermSlugs,
  resolveAlias,
  type AliasCandidate,
  type CuratedEmoji,
} from "@template/core";
import en from "../../../packages/shared/messages/en.json";
import {
  checkLandmarks,
  checkPage,
  LANDMARK_RULES,
  PAGE_RULES,
  type PageReport,
} from "./support/axe";
import { UNCLAIMED_SEVERAL_ALIAS } from "./support/aliases";
import { describeContrast, measureContrast } from "./support/contrast";
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
 *
 * Each page also runs axe's best-practice `landmark-one-main` and `region`
 * rules by name, under the same three assertions
 * ([#177](https://github.com/joshstothard/3moji/issues/177)). And the two
 * things axe cannot see - placeholder text and a glyph hidden from assistive
 * technology - have their contrast measured directly.
 */

const builderCopy = en.HandleBuilder;
const handleCopy = en.HandlePage;
const claimCopy = en.Claim;
const editCopy = en.ProfileEdit;

/** WCAG 1.4.3 Contrast (Minimum), for text at normal size. */
const TEXT_CONTRAST = 4.5;

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

function expectLandmarksContained(report: PageReport): void {
  expect(report.violations, "axe landmark violations").toEqual([]);
  expect(report.incomplete, "axe landmark incomplete results").toEqual([]);
  expect(report.passed, "landmark rules that ran and passed").toEqual(
    expect.arrayContaining([...LANDMARK_RULES]),
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
  expectLandmarksContained(await checkLandmarks(page));
});

test("the picker's search placeholder meets text contrast", async ({
  page,
}) => {
  // Placeholder text is text, so WCAG 1.4.3's 4.5:1 applies - and axe does not
  // reliably evaluate `::placeholder`, so the check above is no evidence.
  await openHome(page);
  const field = page.getByRole("searchbox", {
    name: builderCopy.pickerSearchLabel,
  });
  await expect(field).toHaveValue("");
  await expect(field).toHaveAttribute(
    "placeholder",
    builderCopy.pickerSearchPlaceholder,
  );

  const measured = await measureContrast(field, "::placeholder");
  const account = describeContrast("search placeholder", measured);
  console.log(account);

  expect(measured.ratio, account).toBeGreaterThanOrEqual(TEXT_CONTRAST);
});

test("the Profile edit form's drag handle meets text contrast", async ({
  page,
}) => {
  // The handle is a pointer-only duplicate of the move buttons, hidden from
  // assistive technology (#107), which argues for WCAG 1.4.11's 3:1. It is
  // also a rendered character, which argues for 1.4.3's 4.5:1. The stricter
  // threshold is asserted, so the fix does not rest on the contested reading.
  const seeded = await seedClaimedHandle();

  await page.goto("/sign-in");
  await page
    .getByLabel(claimCopy.signInEmailLabel)
    .fill(seeded.credentials.email);
  await page
    .getByLabel(claimCopy.signInPasswordLabel)
    .fill(seeded.credentials.password);
  await page.getByRole("button", { name: claimCopy.signInSubmit }).click();
  await expect(page).not.toHaveURL(/\/sign-in/);

  await page.goto(`${seeded.path}/edit`);
  const handle = page.getByTitle(
    editCopy.dragLinkHandle.replace("{position}", "1"),
  );
  await expect(handle).toBeVisible();

  const measured = await measureContrast(handle);
  const account = describeContrast("drag handle", measured);
  console.log(account);

  expect(measured.ratio, account).toBeGreaterThanOrEqual(TEXT_CONTRAST);
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
  expectLandmarksContained(await checkLandmarks(page));
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
  expectLandmarksContained(await checkLandmarks(page));
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
    // Another spec needs this alias to stay unclaimed; seeding it made that
    // spec fail on every attempt when the random pick landed here (#177).
    if (alias === UNCLAIMED_SEVERAL_ALIAS) return [];
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
