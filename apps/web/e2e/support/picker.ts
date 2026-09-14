import type { Locator, Page } from "@playwright/test";
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
