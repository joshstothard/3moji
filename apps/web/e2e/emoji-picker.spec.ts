import { expect, test, type Locator } from "@playwright/test";
import { curatedEmojiSet, RELEASED_CATEGORIES } from "@template/core";
import { categoryTab, categoryTabs, emojiGrid, picker } from "./support/picker";

/**
 * The picker's tabs and grid, in the real browser
 * ([#253](https://github.com/joshstothard/3moji/issues/253)).
 *
 * jsdom evaluates no CSS, so `emoji-picker.test.tsx` can only pin the classes.
 * This is where the cells are measured: square, at least WCAG 2.5.8's 44px
 * target, about 56px on a phone and 64px above, with glyphs of 36px and 44px,
 * and a grid that fills its card evenly rather than leaving a gap on the
 * right — which is what an iPhone showed before, six fixed cells left-aligned.
 *
 * Both projects run it: `chromium` is a 1280px desktop, `Mobile Chrome` a
 * 412px Pixel 7. A screenshot of the picker is attached to the report for a
 * human to compare against the design; there is no pixel baseline, because
 * emoji glyphs render differently on every platform.
 */

/** The phone breakpoint: Tailwind's `sm` is 40rem. */
const SM_BREAKPOINT = 640;

/** WCAG 2.5.8 asks for 24px; the project's own floor is 44px. */
const MIN_TARGET = 44;

/** How far a column may miss the card's content edge, in CSS pixels. */
const TOLERANCE = 1;

interface GridGeometry {
  readonly contentLeft: number;
  readonly contentRight: number;
  readonly firstLeft: number;
  readonly lastRight: number;
  readonly columns: number;
  readonly cells: readonly { width: number; height: number }[];
  readonly glyphSize: string;
}

async function geometryOf(grid: Locator): Promise<GridGeometry> {
  return grid.evaluate((list): GridGeometry => {
    const box = list.getBoundingClientRect();
    const style = getComputedStyle(list);
    const buttons = [...list.querySelectorAll("button")];
    const rects = buttons.map((button) => button.getBoundingClientRect());
    const firstTop = rects[0]?.top ?? 0;
    const glyph = buttons[0]?.querySelector("span");
    return {
      contentLeft:
        box.left +
        Number.parseFloat(style.borderLeftWidth) +
        Number.parseFloat(style.paddingLeft),
      contentRight:
        box.right -
        Number.parseFloat(style.borderRightWidth) -
        Number.parseFloat(style.paddingRight),
      firstLeft: Math.min(...rects.map((rect) => rect.left)),
      lastRight: Math.max(...rects.map((rect) => rect.right)),
      columns: rects.filter((rect) => Math.abs(rect.top - firstTop) < 1).length,
      cells: rects.map((rect) => ({ width: rect.width, height: rect.height })),
      glyphSize: glyph ? getComputedStyle(glyph).fontSize : "",
    };
  });
}

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect(categoryTabs(page).first()).toBeVisible();
});

test("the picker has no search box, and its tabs are the only way to change the grid", async ({
  page,
}) => {
  await expect(picker(page).getByRole("searchbox")).toHaveCount(0);
  await expect(picker(page).getByRole("textbox")).toHaveCount(0);

  for (const category of RELEASED_CATEGORIES) {
    const tab = categoryTab(page, category);
    await tab.click();
    await expect(tab).toHaveAttribute("aria-pressed", "true");
    const expected = curatedEmojiSet.filter(
      (entry) => entry.category === category,
    );
    await expect(emojiGrid(page).getByRole("button")).toHaveCount(
      expected.length,
    );
  }
});

test("every emoji cell is a square target sized for the screen, with its glyph to match", async ({
  page,
}, testInfo) => {
  const viewport = page.viewportSize();
  if (viewport === null) {
    throw new Error("The project sets no viewport.");
  }
  const phone = viewport.width < SM_BREAKPOINT;
  const [minCell, maxCell] = phone ? [MIN_TARGET, 68] : [60, 80];

  for (const category of RELEASED_CATEGORIES) {
    await categoryTab(page, category).click();
    const geometry = await geometryOf(emojiGrid(page));
    const account = `${category} at ${String(viewport.width)}px: ${JSON.stringify({ ...geometry, cells: geometry.cells.slice(0, 2) })}`;
    console.log(account);

    expect(geometry.cells.length, account).toBeGreaterThan(0);
    for (const cell of geometry.cells) {
      expect(Math.abs(cell.width - cell.height), account).toBeLessThanOrEqual(
        TOLERANCE,
      );
      expect(cell.width, account).toBeGreaterThanOrEqual(minCell);
      expect(cell.width, account).toBeLessThanOrEqual(maxCell);
    }
    expect(geometry.glyphSize, account).toBe(phone ? "36px" : "44px");
    if (phone) {
      expect(geometry.columns, account).toBe(5);
    }
  }

  await testInfo.attach("picker", {
    body: await picker(page).screenshot(),
    contentType: "image/png",
  });
});

test("the grid fills its card evenly, its first and last columns on the card's padding", async ({
  page,
}) => {
  const geometry = await geometryOf(emojiGrid(page));
  const account = JSON.stringify(geometry, (key, value: unknown) =>
    key === "cells" ? undefined : value,
  );
  console.log(`picker grid: ${account}`);

  expect(
    Math.abs(geometry.firstLeft - geometry.contentLeft),
    account,
  ).toBeLessThanOrEqual(TOLERANCE);
  expect(
    Math.abs(geometry.contentRight - geometry.lastRight),
    account,
  ).toBeLessThanOrEqual(TOLERANCE);
});

test("a pressed emoji draws no focus ring, and a keyboard-focused one does", async ({
  page,
}) => {
  const first = emojiGrid(page).getByRole("button").first();
  await first.click();

  const afterPointer = await first.evaluate((button) => ({
    focusVisible: button.matches(":focus-visible"),
    outline: getComputedStyle(button).outlineStyle,
  }));
  expect(afterPointer.outline).toBe("none");

  // Back to the last tab, then Tab into the grid: the keyboard's ring.
  const tabs = categoryTabs(page);
  await tabs.last().focus();
  await page.keyboard.press("Tab");
  await expect(first).toBeFocused();
  const afterKeyboard = await first.evaluate((button) => ({
    focusVisible: button.matches(":focus-visible"),
    outline: getComputedStyle(button).outlineStyle,
  }));
  expect(afterKeyboard).toEqual({ focusVisible: true, outline: "solid" });
});
