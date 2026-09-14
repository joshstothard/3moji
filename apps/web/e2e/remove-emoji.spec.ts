import { expect, test, type Locator, type Page } from "@playwright/test";
import en from "../../../packages/shared/messages/en.json";
import { checkPage, PAGE_RULES } from "./support/axe";
import {
  describeBorderContrast,
  describeContrast,
  measureBorderContrast,
  measureContrast,
} from "./support/contrast";
import { categoryTabs, pickEmojiByName } from "./support/picker";

/**
 * Removing an emoji from a slot, in the real browser
 * ([#252](https://github.com/joshstothard/3moji/issues/252)).
 *
 * jsdom evaluates no CSS, so this is where the two cues are proved to show
 * where they should. **With a pointer that can hover** (`chromium`), hovering
 * or keyboard-focusing a filled slot draws a coral X over the faded emoji and a
 * "Remove <name>" label, and a click or Enter removes it. **On a touch screen**
 * (`Mobile Chrome`, where `(hover: none)` matches), every filled slot wears a
 * small X badge instead, and a tap removes it. Each test first asserts which
 * kind of device it is on, so a project whose emulation changed could not pass
 * the wrong half.
 *
 * The accessible name, and that the marks live inside the one slot control,
 * are proved in `handle-builder.test.tsx`.
 */

const copy = en.HandleBuilder;

/** WCAG 1.4.3 Contrast (Minimum), for text at normal size. */
const TEXT_CONTRAST = 4.5;

/** WCAG 1.4.11 Non-text Contrast, for a graphic or a control's edge. */
const NON_TEXT_CONTRAST = 3;

/** The brand's coral, `#E5484D`, as Chromium reports a computed colour. */
const CORAL = "rgb(229, 72, 77)";

/** Key presses a focus move may take before the spec gives up. */
const MAX_PRESSES = 60;

function slots(page: Page): Locator {
  return page.getByRole("group", { name: copy.slotsLabel }).getByRole("button");
}

function filledName(position: number, name: string): string {
  return copy.slotFilled
    .replace("{position}", String(position))
    .replace("{name}", name);
}

function emptyName(position: number): string {
  return copy.slotEmpty.replace("{position}", String(position));
}

/** The visible label, hidden from assistive technology like the X it names. */
function removeLabel(slot: Locator, name: string): Locator {
  return slot.getByText(copy.slotRemoveHint.replace("{name}", name), {
    exact: true,
  });
}

function removeMark(slot: Locator): Locator {
  return slot.locator("[data-remove-mark]");
}

function removeBadge(slot: Locator): Locator {
  return slot.locator("[data-remove-badge]");
}

function glyph(slot: Locator): Locator {
  return slot.locator("[data-slot-glyph]");
}

async function openBuilder(
  page: Page,
  ...names: readonly string[]
): Promise<void> {
  await page.goto("/");
  await expect(categoryTabs(page).first()).toBeVisible();
  // The picker has no search box since #253: each pick opens the emoji's
  // category tab and presses the emoji.
  for (const name of names) {
    await pickEmojiByName(page, name);
  }
}

async function canHover(page: Page): Promise<boolean> {
  return page.evaluate(() => matchMedia("(hover: hover)").matches);
}

async function moveFocusTo(
  page: Page,
  target: Locator,
  key: "Tab" | "Shift+Tab",
): Promise<void> {
  for (let presses = 0; presses < MAX_PRESSES; presses += 1) {
    await page.keyboard.press(key);
    if (await target.evaluate((element) => element === document.activeElement))
      return;
  }
  throw new Error(`${key} did not reach the target in ${String(MAX_PRESSES)}.`);
}

async function expectAxeClean(page: Page): Promise<void> {
  // Picking scrolls the grid under the sticky slot row (#263), and axe cannot
  // work out the colour behind text that overlaps other content, so the page
  // is checked from the top. The slots are still there, in the row.
  await page.evaluate(() => {
    window.scrollTo(0, 0);
  });
  const report = await checkPage(page);
  expect(report.violations, "axe violations").toEqual([]);
  expect(report.incomplete, "axe incomplete results").toEqual([]);
  expect(report.passed, "rules that ran and passed").toEqual(
    expect.arrayContaining([...PAGE_RULES, "button-name"]),
  );
}

test.describe("with a pointer that can hover", () => {
  test.skip(
    ({ isMobile }) => isMobile,
    "Nothing hovers on a touch screen; the badge is proved below.",
  );

  test("hovering a filled slot draws a coral X over the faded emoji with a Remove label, and a click removes it", async ({
    page,
  }) => {
    await openBuilder(page, "ice cube", "pizza");
    expect(await canHover(page), "this project can hover").toBe(true);
    const slot = slots(page).nth(1);
    await expect(slot).toHaveAccessibleName(filledName(2, "pizza"));

    // At rest: neither cue, and no badge on a device that can hover.
    await expect(removeMark(slot)).toBeHidden();
    await expect(removeLabel(slot, "pizza")).toBeHidden();
    await expect(removeBadge(slot)).toBeHidden();

    await slot.hover();

    await expect(removeMark(slot)).toBeVisible();
    await expect(removeLabel(slot, "pizza")).toBeVisible();
    await expect(glyph(slot)).toHaveCSS("opacity", "0.35");
    await expect(slot).toHaveCSS("border-top-color", CORAL);
    await expect(removeBadge(slot)).toBeHidden();

    // The label is text: white on ink. The X is a graphic, coral on the
    // slot's paper fill. The border is the control's edge.
    const label = await measureContrast(removeLabel(slot, "pizza"));
    const labelAccount = describeContrast("remove label", label);
    console.log(labelAccount);
    expect
      .soft(label.ratio, labelAccount)
      .toBeGreaterThanOrEqual(TEXT_CONTRAST);

    const mark = await measureContrast(removeMark(slot));
    const markAccount = describeContrast("remove X", mark);
    console.log(markAccount);
    expect
      .soft(mark.ratio, markAccount)
      .toBeGreaterThanOrEqual(NON_TEXT_CONTRAST);

    const border = await measureBorderContrast(slot);
    const borderAccount = describeBorderContrast("hovered slot", border);
    console.log(borderAccount);
    expect
      .soft(border.ratio, borderAccount)
      .toBeGreaterThanOrEqual(NON_TEXT_CONTRAST);

    await slot.click();

    await expect(slot).toHaveAccessibleName(emptyName(2));
    await expect(removeMark(slot)).toHaveCount(0);
    await expect(removeLabel(slot, "pizza")).toHaveCount(0);
    await expect(slots(page).nth(0)).toHaveAccessibleName(
      filledName(1, "ice cube"),
    );
  });

  test("keyboard focus on a filled slot shows the X and the label, and Enter removes the emoji with focus kept on the slot", async ({
    page,
  }) => {
    await openBuilder(page, "ice cube", "pizza");
    const slot = slots(page).nth(1);
    await expect(slot).toHaveAccessibleName(filledName(2, "pizza"));

    // Back up from the picker's first category tab, which follows the slots,
    // so the focus that lands on the slot is a keyboard's.
    await categoryTabs(page).first().focus();
    await moveFocusTo(page, slot, "Shift+Tab");

    await expect(removeMark(slot)).toBeVisible();
    await expect(removeLabel(slot, "pizza")).toBeVisible();
    await expect(glyph(slot)).toHaveCSS("opacity", "0.35");

    await page.keyboard.press("Enter");

    await expect(slot).toHaveAccessibleName(emptyName(2));
    await expect(slot).toBeFocused();
    await expect(removeMark(slot)).toHaveCount(0);
  });

  test("the page passes axe with a slot hovered and its Remove label showing", async ({
    page,
  }) => {
    await openBuilder(page, "ice cube");
    const slot = slots(page).nth(0);
    await slot.hover();
    await expect(removeLabel(slot, "ice cube")).toBeVisible();

    await expectAxeClean(page);
  });
});

test.describe("on a touch screen that cannot hover", () => {
  test.skip(
    ({ isMobile }) => !isMobile,
    "A device that can hover shows the X on hover instead; proved above.",
  );

  test("every filled slot wears a small X badge, and a tap removes the emoji", async ({
    page,
  }) => {
    await openBuilder(page, "ice cube", "pizza");
    expect(await canHover(page), "this project cannot hover").toBe(false);
    const [first, second, third] = [0, 1, 2].map((index) =>
      slots(page).nth(index),
    );
    if (first === undefined || second === undefined || third === undefined) {
      throw new Error("expected three slots");
    }
    await expect(first).toHaveAccessibleName(filledName(1, "ice cube"));
    await expect(second).toHaveAccessibleName(filledName(2, "pizza"));

    for (const [slot, name] of [
      [first, "ice cube"],
      [second, "pizza"],
    ] as const) {
      await expect(removeBadge(slot)).toBeVisible();
      await expect(removeMark(slot)).toBeHidden();
      await expect(removeLabel(slot, name)).toBeHidden();

      // A white X on an ink disc.
      const badge = await measureContrast(removeBadge(slot));
      const account = describeContrast(`badge on ${name}`, badge);
      console.log(account);
      expect
        .soft(badge.ratio, account)
        .toBeGreaterThanOrEqual(NON_TEXT_CONTRAST);
    }
    // An empty slot has nothing to remove.
    await expect(removeBadge(third)).toHaveCount(0);

    await expectAxeClean(page);

    await first.tap();

    await expect(first).toHaveAccessibleName(emptyName(1));
    await expect(removeBadge(first)).toHaveCount(0);
    await expect(removeBadge(second)).toBeVisible();
  });
});
