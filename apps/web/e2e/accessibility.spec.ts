import { expect, test, type Locator, type Page } from "@playwright/test";
import {
  aliasTermSlugs,
  canonicalise,
  curatedEmojiSet,
  HANDLE_LENGTH,
  isReservedHandle,
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
import {
  describeBorderContrast,
  describeContrast,
  measureBorderContrast,
  measureContrast,
} from "./support/contrast";
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

/** WCAG 1.4.11 Non-text Contrast, for what identifies a control. */
const NON_TEXT_CONTRAST = 3;

/**
 * A text field's border is the cue that identifies it as a control
 * ([#182](https://github.com/joshstothard/3moji/issues/182)): no field's fill
 * or shadow reaches 3:1 against the page, so the border has to.
 *
 * Soft, so a single run reports every field on the page rather than the first
 * that fails.
 */
async function expectBorderIdentifiesField(
  field: Locator,
  subject: string,
): Promise<void> {
  await expect(field).toBeVisible();
  const measured = await measureBorderContrast(field);
  const account = describeBorderContrast(subject, measured);
  console.log(account);

  expect
    .soft(measured.ratio, account)
    .toBeGreaterThanOrEqual(NON_TEXT_CONTRAST);
}

/**
 * The path to a Handle nobody has claimed, so its page renders the builder and
 * the claim form. Random, as `seedClaimedHandle` is, so it cannot collide with
 * a Handle another spec claims in the shared database; a Reserved pick is
 * simply drawn again.
 */
function unclaimedHandlePath(): string {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const segment = Array.from(
      { length: HANDLE_LENGTH },
      () => randomOf(curatedEmojiSet).emoji,
    ).join("");
    const result = canonicalise(segment);
    if (result.ok && !isReservedHandle(result.key)) {
      return `/${result.encoded}`;
    }
  }
  throw new Error("Could not draw an unreserved Handle.");
}

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

test("the picker's search field border meets non-text contrast", async ({
  page,
}) => {
  await openHome(page);

  await expectBorderIdentifiesField(
    page.getByRole("searchbox", { name: builderCopy.pickerSearchLabel }),
    "picker search",
  );
});

test("the claim form's field borders meet non-text contrast", async ({
  page,
}) => {
  await page.goto(unclaimedHandlePath());

  await expectBorderIdentifiesField(
    page.getByRole("textbox", { name: claimCopy.claimEmailLabel }),
    "claim email",
  );
  await expectBorderIdentifiesField(
    page.getByLabel(claimCopy.claimPasswordLabel, { exact: true }),
    "claim password",
  );
});

test("the hold screen's resend field border meets non-text contrast", async ({
  page,
}) => {
  await page.goto("/claim/held");

  await expectBorderIdentifiesField(
    page.getByLabel(claimCopy.resendEmailLabel, { exact: true }),
    "resend email",
  );
});

test("the sign-in form's field borders meet non-text contrast", async ({
  page,
}) => {
  // Measured without submitting: a form sign-in counts against the per-client
  // sign-in rate limit, and nothing here needs a session.
  await page.goto("/sign-in");

  await expectBorderIdentifiesField(
    page.getByLabel(claimCopy.signInEmailLabel, { exact: true }),
    "sign-in email",
  );
  await expectBorderIdentifiesField(
    page.getByLabel(claimCopy.signInPasswordLabel, { exact: true }),
    "sign-in password",
  );
});

test("the share link's manual-copy field border meets non-text contrast", async ({
  page,
}) => {
  // The field appears only when copying fails, so the clipboard refuses.
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: () => Promise.reject(new Error("Refused for the test.")),
      },
    });
  });
  const seeded = await seedClaimedHandle();

  await page.goto(seeded.path);
  await page.getByRole("button", { name: handleCopy.shareCopy }).click();

  await expectBorderIdentifiesField(
    page.getByLabel(handleCopy.shareManualLabel, { exact: true }),
    "share link manual copy",
  );
});

test("the Profile edit form's drag handle and field borders meet contrast", async ({
  page,
}) => {
  // The handle is a pointer-only duplicate of the move buttons, hidden from
  // assistive technology (#107), which argues for WCAG 1.4.11's 3:1. It is
  // also a rendered character, which argues for 1.4.3's 4.5:1. The stricter
  // threshold is asserted, so the fix does not rest on the contested reading.
  //
  // The field borders (#182) are measured in this test rather than their own
  // so the suite signs in through the form once per project, not twice: the
  // form is rate limited per client, and every E2E request comes from one.
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

  // Two surfaces: the display name and bio sit on the page, the Link fields
  // inside the white Links fieldset.
  await expectBorderIdentifiesField(
    page.getByLabel(editCopy.displayNameLabel, { exact: true }),
    "edit display name",
  );
  await expectBorderIdentifiesField(
    page.getByLabel(editCopy.bioLabel, { exact: true }),
    "edit bio",
  );
  await expectBorderIdentifiesField(
    page.getByLabel(editCopy.linkTitleLabel.replace("{position}", "1"), {
      exact: true,
    }),
    "edit link 1 title",
  );
  await expectBorderIdentifiesField(
    page.getByLabel(editCopy.linkUrlLabel.replace("{position}", "1"), {
      exact: true,
    }),
    "edit link 1 web address",
  );
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
