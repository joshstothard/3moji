import { randomUUID } from "node:crypto";

import { expect, test, type Locator, type Page } from "@playwright/test";
import {
  canonicalise,
  curatedEmojiSet,
  HANDLE_LENGTH,
  isReservedHandle,
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
import {
  listingAliases,
  UNCLAIMED_SEVERAL_ALIAS,
  unclaimedSeveralHandleKeys,
} from "./support/aliases";
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
const resetCopy = en.PasswordReset;

/** WCAG 1.4.3 Contrast (Minimum), for text at normal size. */
const TEXT_CONTRAST = 4.5;

/** WCAG 1.4.11 Non-text Contrast, for what identifies a control. */
const NON_TEXT_CONTRAST = 3;

/**
 * A control's border is the cue that identifies it as a control: no text
 * field's fill or shadow reaches 3:1 against the page
 * ([#182](https://github.com/joshstothard/3moji/issues/182)), and nor does the
 * white fill or shadow of a Handle builder button
 * ([#185](https://github.com/joshstothard/3moji/issues/185)), so the border has
 * to.
 *
 * Soft, so a single run reports every control on the page rather than the
 * first that fails.
 */
async function expectBorderIdentifiesControl(
  control: Locator,
  subject: string,
): Promise<void> {
  await expect(control).toBeVisible();
  const measured = await measureBorderContrast(control);
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

  await expectBorderIdentifiesControl(
    page.getByRole("searchbox", { name: builderCopy.pickerSearchLabel }),
    "picker search",
  );
});

test("the Handle builder's slot and swap-suggestion borders meet non-text contrast", async ({
  page,
}) => {
  // The slots and swap suggestions wear a white fill and `shadow-sm` on the
  // `slate-50` page, neither of which reaches 3:1, so their border is what
  // identifies them as controls (#185). An empty slot has no glyph at all.
  // Every slot is measured empty and again filled, since filling one changes
  // its border style, and the Handle is one somebody has already claimed, so
  // the swap suggestions appear. Nothing here signs in.
  const seeded = await seedClaimedHandle();

  await openHome(page);
  const slots = page
    .getByRole("group", { name: builderCopy.slotsLabel })
    .getByRole("button");
  await expect(slots).toHaveCount(HANDLE_LENGTH);
  for (let position = 0; position < HANDLE_LENGTH; position += 1) {
    const slot = slots.nth(position);
    await expect(slot).toHaveAttribute("aria-disabled", "true");
    await expectBorderIdentifiesControl(
      slot,
      `empty slot ${String(position + 1)}`,
    );
  }

  const search = page.getByRole("searchbox", {
    name: builderCopy.pickerSearchLabel,
  });
  for (const entry of seeded.emoji) {
    await search.fill(entry.displayName);
    await page
      .getByRole("button", { name: entry.displayName, exact: true })
      .click();
  }
  await expect(page.getByText(builderCopy.stateClaimed)).toBeVisible();

  for (let position = 0; position < HANDLE_LENGTH; position += 1) {
    const slot = slots.nth(position);
    await expect(slot).toHaveAttribute("aria-disabled", "false");
    await expectBorderIdentifiesControl(
      slot,
      `filled slot ${String(position + 1)}`,
    );
  }

  const suggestions = page
    .getByRole("group", { name: builderCopy.swapHeading })
    .getByRole("button");
  // Measuring no suggestions would pass for nothing.
  await expect(suggestions.first()).toBeVisible();
  const count = await suggestions.count();
  for (let index = 0; index < count; index += 1) {
    await expectBorderIdentifiesControl(
      suggestions.nth(index),
      `swap suggestion ${String(index + 1)} of ${String(count)}`,
    );
  }
});

test("the claim form's field borders meet non-text contrast", async ({
  page,
}) => {
  await page.goto(unclaimedHandlePath());

  await expectBorderIdentifiesControl(
    page.getByRole("textbox", { name: claimCopy.claimEmailLabel }),
    "claim email",
  );
  await expectBorderIdentifiesControl(
    page.getByLabel(claimCopy.claimPasswordLabel, { exact: true }),
    "claim password",
  );
});

test("the claim form's privacy and terms links meet text contrast (#198)", async ({
  page,
}) => {
  await page.goto(unclaimedHandlePath());

  for (const name of [claimCopy.claimPrivacyLink, claimCopy.claimTermsLink]) {
    const link = page.getByRole("link", { name });
    await expect(link).toBeVisible();
    const measured = await measureContrast(link);
    const account = describeContrast(`claim form link "${name}"`, measured);
    console.log(account);

    expect.soft(measured.ratio, account).toBeGreaterThanOrEqual(TEXT_CONTRAST);
  }
});

test("the footer's links and text meet text contrast (#198)", async ({
  page,
}) => {
  // axe's color-contrast covers these on every page it checks; this measures
  // them directly, on a static page and on a Profile, which have different
  // content above the footer but must paint the footer the same.
  const seeded = await seedClaimedHandle();
  const footerCopy = en.Footer;

  for (const path of ["/privacy", seeded.path]) {
    await page.goto(path);
    const footer = page.getByRole("contentinfo");
    const targets = [
      footer.getByRole("link", { name: footerCopy.privacy }),
      footer.getByRole("link", { name: footerCopy.terms }),
      footer.getByRole("link", { name: footerCopy.report }),
      footer.getByRole("link", { name: footerCopy.emojiCreditTwemoji }),
      footer.getByRole("link", { name: footerCopy.emojiCreditLicence }),
      footer.getByText(/^UI: v/),
    ];

    for (const target of targets) {
      await expect(target).toBeVisible();
      const measured = await measureContrast(target);
      const account = describeContrast(
        `footer on ${path}: ${(await target.textContent()) ?? ""}`,
        measured,
      );
      console.log(account);

      expect
        .soft(measured.ratio, account)
        .toBeGreaterThanOrEqual(TEXT_CONTRAST);
    }
  }
});

test("the hold screen's resend field border meets non-text contrast", async ({
  page,
}) => {
  await page.goto("/claim/held");

  await expectBorderIdentifiesControl(
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

  await expectBorderIdentifiesControl(
    page.getByLabel(claimCopy.signInEmailLabel, { exact: true }),
    "sign-in email",
  );
  await expectBorderIdentifiesControl(
    page.getByLabel(claimCopy.signInPasswordLabel, { exact: true }),
    "sign-in password",
  );
});

test("the password reset request page has no WCAG A or AA violations, and its field border meets non-text contrast", async ({
  page,
}) => {
  // Measured without submitting: the request form is limited per client (#192).
  await page.goto("/reset-password");
  await expect(
    page.getByRole("heading", { level: 1, name: resetCopy.requestHeading }),
  ).toBeVisible();

  expectAccessible(await checkPage(page), [
    "label",
    "button-name",
    "autocomplete-valid",
  ]);
  expectLandmarksContained(await checkLandmarks(page));
  await expectBorderIdentifiesControl(
    page.getByLabel(resetCopy.emailLabel, { exact: true }),
    "password reset request email",
  );
});

test("the set-new-password page has no WCAG A or AA violations, and its field border meets non-text contrast", async ({
  page,
}) => {
  // The token is checked when the form is submitted, not when the page
  // renders, so any path segment renders the form (#192).
  await page.goto(`/reset-password/${randomUUID().replaceAll("-", "")}`);
  await expect(
    page.getByRole("heading", { level: 1, name: resetCopy.setHeading }),
  ).toBeVisible();

  expectAccessible(await checkPage(page), [
    "label",
    "button-name",
    "autocomplete-valid",
    "aria-valid-attr-value",
  ]);
  expectLandmarksContained(await checkLandmarks(page));
  await expectBorderIdentifiesControl(
    page.getByLabel(resetCopy.newPasswordLabel, { exact: true }),
    "set-new-password password",
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

  await expectBorderIdentifiesControl(
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
  await expectBorderIdentifiesControl(
    page.getByLabel(editCopy.displayNameLabel, { exact: true }),
    "edit display name",
  );
  await expectBorderIdentifiesControl(
    page.getByLabel(editCopy.bioLabel, { exact: true }),
    "edit bio",
  );
  await expectBorderIdentifiesControl(
    page.getByLabel(editCopy.linkTitleLabel.replace("{position}", "1"), {
      exact: true,
    }),
    "edit link 1 title",
  );
  await expectBorderIdentifiesControl(
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

for (const [path, legalCopy] of [
  ["/privacy", en.Legal.Privacy],
  ["/terms", en.Legal.Terms],
] as const) {
  test(`${path} has no WCAG A or AA violations`, async ({ page }) => {
    // Contrast is axe's `color-contrast`, in PAGE_RULES: the draft marker's
    // amber and the related link's indigo are measured from the real CSS
    // (#196). Nothing here is a placeholder or a hidden glyph, so the direct
    // measurements above have nothing to add.
    await page.goto(path);
    await expect(
      page.getByRole("heading", { level: 1, name: legalCopy.heading }),
    ).toBeVisible();
    await expect(page.getByText(en.Legal.draftMarker)).toBeVisible();

    expectAccessible(await checkPage(page), ["list", "listitem"]);
    expectLandmarksContained(await checkLandmarks(page));
  });
}

test("the alias listing never seeds a Handle handle-url.spec.ts needs unclaimed", () => {
  // Every spec shares one database, and handle-url.spec.ts needs every Handle
  // UNCLAIMED_SEVERAL_ALIAS names to stay unclaimed. Another alias can name the
  // same Handles in other words, so the listing's candidates are checked by the
  // Handles they resolve to, not by their text (#187).
  const reserved = unclaimedSeveralHandleKeys();
  const eligible = listingAliases();
  expect(eligible.length, "aliases the listing can seed under").toBeGreaterThan(
    0,
  );

  const overlapping = eligible
    .filter(({ candidates }) =>
      candidates.some((candidate) => reserved.has(candidate.key)),
    )
    .map(({ alias }) => alias);
  expect(
    overlapping,
    `listing aliases naming a Handle ${UNCLAIMED_SEVERAL_ALIAS} names`,
  ).toEqual([]);
});

test("the find page's not-found answer has no WCAG A or AA violations (#200)", async ({
  page,
}) => {
  await page.goto(`/find?q=${encodeURIComponent("three wibbles")}`);
  await expect(
    page.getByRole("heading", { level: 1, name: en.FindPage.notFoundHeading }),
  ).toBeVisible();

  expectAccessible(await checkPage(page), ["label", "button-name"]);
  expectLandmarksContained(await checkLandmarks(page));
});

test("the Handle lookup's field border meets non-text contrast (#200)", async ({
  page,
}) => {
  const field = page.getByRole("searchbox", { name: en.HandleLookup.label });

  await openHome(page);
  await expectBorderIdentifiesControl(field, "lookup field on /");

  await page.goto(`/find?q=${encodeURIComponent("three wibbles")}`);
  await expectBorderIdentifiesControl(field, "lookup field on /find");
});

test("an alias listing has no WCAG A or AA violations", async ({ page }) => {
  // Picked at random from the domain's own vocabulary, so both Playwright
  // projects and retries spread their seeds across many aliases.
  const { alias, candidates } = randomOf(listingAliases());
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

test("the branded 404 has no WCAG A or AA violations (#203)", async ({
  page,
}) => {
  // Contrast is axe's `color-contrast`, in PAGE_RULES, measured from the real
  // CSS: the heading, the body text and the white-on-indigo home link.
  const response = await page.goto("/no/such/page");
  expect(response?.status()).toBe(404);
  await expect(
    page.getByRole("heading", { level: 1, name: en.NotFoundPage.heading }),
  ).toBeVisible();

  expectAccessible(await checkPage(page), []);
  expectLandmarksContained(await checkLandmarks(page));
});

test("the branded error page has no WCAG A or AA violations (#203)", async ({
  page,
}) => {
  // `/test-only-error` throws only because CI sets TEST_ERROR_ROUTE
  // (lib/test-error-route.ts). Contrast is axe's `color-contrast`, covering the
  // white-on-indigo retry button and the indigo home link.
  const response = await page.goto("/test-only-error");
  expect(response?.status()).toBe(500);
  await expect(
    page.getByRole("heading", { level: 1, name: en.ErrorPage.heading }),
  ).toBeVisible();

  expectAccessible(await checkPage(page), ["button-name"]);
  expectLandmarksContained(await checkLandmarks(page));
});

function randomOf<T>(items: readonly T[]): T {
  const item = items[Math.floor(Math.random() * items.length)];
  if (item === undefined) {
    throw new Error("Nothing to choose from.");
  }
  return item;
}
