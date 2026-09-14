import { expect, type Locator, type Page } from "@playwright/test";
import { curatedEmojiSet, type CuratedEmoji } from "@template/core";
import en from "../../../../packages/shared/messages/en.json";

/**
 * Picking an emoji the way a visitor does since #253: open its category's tab,
 * then press the emoji. The picker has no search box any more, so a spec that
 * used to type "ice cube" now selects Food & Drink and clicks the ice cube.
 */

const copy = en.HandleBuilder;

/** The picker's section, named by its heading. */
export function picker(page: Page): Locator {
  return page.getByRole("region", { name: copy.pickerHeading });
}

/** The picker's category toggle buttons. */
export function categoryTabs(page: Page): Locator {
  return picker(page)
    .getByRole("group", { name: copy.pickerCategoriesLabel })
    .getByRole("button");
}

/** The tab for one category. */
export function categoryTab(page: Page, category: string): Locator {
  return picker(page)
    .getByRole("group", { name: copy.pickerCategoriesLabel })
    .getByRole("button", { name: category, exact: true });
}

/** The grid of emoji buttons for the open category. */
export function emojiGrid(page: Page): Locator {
  return picker(page).getByRole("list");
}

/** The curated entry a display name belongs to, or a clear failure. */
export function curatedByName(name: string): CuratedEmoji {
  const entry = curatedEmojiSet.find(
    (candidate) => candidate.displayName === name,
  );
  if (entry === undefined) {
    throw new Error(`No curated emoji is displayed as "${name}".`);
  }
  return entry;
}

/** Opens the entry's category and presses its emoji. */
export async function pickEmoji(
  page: Page,
  entry: CuratedEmoji,
): Promise<void> {
  await categoryTab(page, entry.category).click();
  await emojiGrid(page)
    .getByRole("button", { name: entry.displayName, exact: true })
    .click();
}

/** {@link pickEmoji}, by the emoji's display name. */
export async function pickEmojiByName(page: Page, name: string): Promise<void> {
  await pickEmoji(page, curatedByName(name));
}

/** Tailwind's `md`, 48rem: below it the builder takes its phone layout. */
const PHONE_BELOW = 768;

/**
 * Closes the phone's claim sheet, the way a visitor would, so a spec about the
 * page behind it can carry on
 * ([#263](https://github.com/joshstothard/3moji/issues/263)).
 *
 * On a phone a complete, available Handle opens the sheet as a modal dialog,
 * and everything behind it is inert: a click there lands on the backdrop. Call
 * this once the availability line has answered. On a wider screen, or for any
 * answer but available, there is no sheet and it does nothing.
 * `composer.spec.ts` is where the sheet itself is proved.
 */
export async function dismissClaimSheet(page: Page): Promise<void> {
  if (!isPhone(page)) return;
  await expect(page.getByText(copy.checking, { exact: true })).toHaveCount(0);
  const available = page.getByText(copy.stateAvailable, { exact: true });
  if (!(await available.isVisible())) return;

  const sheet = page.getByRole("dialog", { name: en.Claim.claimHeading });
  await expect(sheet).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(sheet).toBeHidden();
}

function isPhone(page: Page): boolean {
  return (page.viewportSize()?.width ?? PHONE_BELOW) < PHONE_BELOW;
}

/**
 * Waits until an unclaimed Handle's claim form is where it will stay, so a
 * spec that measures the form does not measure a node being replaced
 * ([#263](https://github.com/joshstothard/3moji/issues/263)).
 *
 * The server renders the form inline in step 2 on every width. On a phone,
 * hydration then moves it into the claim sheet: the inline form is unmounted
 * and a new one mounted in the dialog. A measurement that lands between the
 * two reads a detached element, whose computed style is empty. On a wider
 * screen the form never moves, so this only waits for it to be visible.
 */
export async function waitForClaimForm(page: Page): Promise<void> {
  const form = page.getByRole("form", { name: en.Claim.claimHeading });
  if (isPhone(page)) {
    await expect(
      page.getByRole("dialog", { name: en.Claim.claimHeading }),
    ).toBeVisible();
  }
  await expect(form).toBeVisible();
}
