import { readFileSync } from "node:fs";

import { expect, test, type Locator, type Page } from "@playwright/test";
import {
  findCuratedEmoji,
  spokenHandle,
  swapSuggestions,
} from "@template/core";
import en from "../../../packages/shared/messages/en.json";
import { seedClaimedHandle } from "./support/seed";

/**
 * The picker, driven by the keyboard alone, end to end
 * ([#154](https://github.com/joshstothard/3moji/issues/154)).
 *
 * From `/`, a visitor who never touches a pointer fills three slots through the
 * picker, meets a Handle somebody already has, takes a swap suggestion, and
 * reaches the claim form. At every step the spec asserts **where focus is** and
 * that the focused control **shows a focus indicator in the real browser** —
 * something jsdom cannot evaluate, so the unit tests cannot say it.
 *
 * **Keyboard only, and proven so twice.** A static guard fails the spec if its
 * own source calls any pointer, synthetic-input or programmatic-focus API, so
 * every focus change below is a real Tab, Shift+Tab or Enter. A runtime guard
 * records every pointer, mouse and touch event the page receives, and a click
 * carrying a pointer's click count, and requires there to be none.
 *
 * **Both projects run it.** `Mobile Chrome` is Pixel 7 emulation in Chromium: a
 * 412px viewport, a mobile user agent and touch support, not a phone and not
 * TalkBack. What it proves is a keyboard, switch or external-keyboard user on a
 * narrow, touch-capable screen: that the narrow layout neither reorders nor
 * hides a control, and that `:focus-visible` still matches under touch
 * emulation, where the browser's modality heuristics could plausibly differ.
 */

const builderCopy = en.HandleBuilder;
const claimCopy = en.Claim;

/**
 * How many key presses a single move may take before the spec concludes focus
 * can never reach its target. Searching keeps the grid to a handful of
 * results, so a real journey needs far fewer.
 */
const MAX_PRESSES = 60;

/**
 * The APIs this spec must never call, spelled as bare names so that this list
 * cannot match itself: the guard below looks for each one called as a method or
 * reached as a property.
 */
const FORBIDDEN_APIS = [
  "click",
  "dblclick",
  "tap",
  "hover",
  "dragTo",
  "check",
  "uncheck",
  "setChecked",
  "selectOption",
  "fill",
  "focus",
  "dispatchEvent",
  "mouse",
  "touchscreen",
] as const;

/** The events a pointer produces and a keyboard never does. */
const POINTER_EVENTS = [
  "pointerdown",
  "pointerup",
  "mousedown",
  "mouseup",
  "touchstart",
  "touchend",
] as const;

declare global {
  interface Window {
    keyboardOnlyPointerEvents?: string[];
  }
}

/** The focus-relevant part of an element's computed style. */
interface FocusStyle {
  readonly outlineStyle: string;
  readonly outlineWidth: string;
  readonly outlineColor: string;
  readonly boxShadow: string;
}

/** What the browser says about whatever currently has focus. */
interface FocusedControl {
  readonly description: string;
  readonly isBody: boolean;
  readonly focusVisible: boolean;
  readonly style: FocusStyle;
}

/** A colour with an alpha of zero, in any notation Chromium serialises. */
const TRANSPARENT = /^transparent$|,\s*0\)$|\/\s*0\)$/;

/**
 * Whether a style draws an outline anybody can see.
 *
 * **Outline only, not box-shadow**, because every control here already wears
 * `shadow-sm` whether or not it has focus: counting a shadow would make every
 * control pass, which is exactly how an earlier draft of this check stayed
 * green against a picker with its focus ring deleted. Nor is a changed
 * `outline-width` or `outline-color` enough on its own — Chromium's own
 * `:focus-visible` rule changes both while `outline-style` stays `none`.
 */
function hasVisibleOutline(style: FocusStyle): boolean {
  return (
    style.outlineStyle !== "none" &&
    style.outlineStyle !== "hidden" &&
    Number.parseFloat(style.outlineWidth) > 0 &&
    !TRANSPARENT.test(style.outlineColor)
  );
}

async function styleOf(control: Locator): Promise<FocusStyle> {
  return control.evaluate((element): FocusStyle => {
    const style = getComputedStyle(element);
    return {
      outlineStyle: style.outlineStyle,
      outlineWidth: style.outlineWidth,
      outlineColor: style.outlineColor,
      boxShadow: style.boxShadow,
    };
  });
}

async function isFocused(control: Locator): Promise<boolean> {
  return control.evaluate((element) => element === document.activeElement);
}

async function focusedControl(page: Page): Promise<FocusedControl> {
  return page.evaluate((): FocusedControl => {
    // Chromium reports <body>, never null, when nothing else has focus.
    const element = document.activeElement ?? document.body;
    const style = getComputedStyle(element);
    return {
      description: `<${element.tagName.toLowerCase()}> ${
        element.getAttribute("aria-label") ??
        element.textContent.trim().slice(0, 40)
      }`,
      isBody: element === document.body,
      focusVisible: element.matches(":focus-visible"),
      style: {
        outlineStyle: style.outlineStyle,
        outlineWidth: style.outlineWidth,
        outlineColor: style.outlineColor,
        boxShadow: style.boxShadow,
      },
    };
  });
}

/**
 * Whatever has focus is a real control, not `<body>`, and shows it: the
 * browser reports `:focus-visible`, and the computed style draws an outline or
 * a shadow.
 */
async function expectFocusShown(page: Page): Promise<void> {
  const focused = await focusedControl(page);
  expect(focused.isBody, "focus was lost to <body>").toBe(false);
  expect(
    focused.focusVisible,
    `${focused.description} has focus but not :focus-visible`,
  ).toBe(true);
  expect(
    hasVisibleOutline(focused.style),
    `${focused.description} has focus but draws no visible outline: ${JSON.stringify(focused.style)}`,
  ).toBe(true);
}

/**
 * `control` has focus and shows an outline **that focus put there**: read from
 * the same node before it had focus, it drew none. That is what stops an
 * outline the control always draws from passing as a focus indicator.
 */
async function expectFocusIndicated(
  page: Page,
  control: Locator,
  unfocused: FocusStyle,
): Promise<void> {
  await expect(control).toBeFocused();
  await expectFocusShown(page);
  expect(
    hasVisibleOutline(unfocused),
    `the control already drew an outline before it had focus: ${JSON.stringify(unfocused)}`,
  ).toBe(false);
}

/**
 * Presses `key` until `target` has focus, checking every control focus lands
 * on along the way, and fails if it takes more than {@link MAX_PRESSES}.
 */
async function moveFocusTo(
  page: Page,
  target: Locator,
  key: "Tab" | "Shift+Tab",
): Promise<void> {
  await expect(target).toBeVisible();
  expect(await isFocused(target), "the target already has focus").toBe(false);
  const unfocused = await styleOf(target);

  for (let presses = 0; presses < MAX_PRESSES; presses += 1) {
    await page.keyboard.press(key);
    await expectFocusShown(page);
    if (await isFocused(target)) {
      await expectFocusIndicated(page, target, unfocused);
      return;
    }
  }
  throw new Error(
    `${key} did not reach the target in ${String(MAX_PRESSES)} presses.`,
  );
}

function slotButton(page: Page, position: number): Locator {
  return page
    .getByRole("group", { name: builderCopy.slotsLabel })
    .getByRole("button")
    .nth(position);
}

function filledSlotName(position: number, name: string): string {
  return builderCopy.slotFilled
    .replace("{position}", String(position + 1))
    .replace("{name}", name);
}

function nameOf(emoji: string): string {
  const entry = findCuratedEmoji(emoji);
  if (entry === undefined) {
    throw new Error(`${emoji} is not in the curated Emoji Set.`);
  }
  return entry.displayName;
}

test("the static guard: this spec calls no pointer API", () => {
  const source = readFileSync(test.info().file, "utf8");

  for (const api of FORBIDDEN_APIS) {
    expect(source, `the spec reaches for .${api}`).not.toContain(`.${api}(`);
    expect(source, `the spec reaches for .${api}`).not.toContain(`.${api}.`);
  }
});

test("a visitor looks up a Handle by keyboard alone (#200)", async ({
  page,
}) => {
  await page.addInitScript((events: readonly string[]) => {
    window.keyboardOnlyPointerEvents = [];
    const record = (event: Event) => {
      window.keyboardOnlyPointerEvents?.push(event.type);
    };
    for (const type of events) {
      window.addEventListener(type, record, { capture: true });
    }
    window.addEventListener(
      "click",
      (event) => {
        if (event.detail > 0) record(event);
      },
      { capture: true },
    );
  }, POINTER_EVENTS);

  const lookupCopy = en.HandleLookup;

  // Words that name no Handle, submitted with the button.
  await page.goto("/");
  const field = page.getByRole("searchbox", { name: lookupCopy.label });
  await moveFocusTo(page, field, "Tab");
  await page.keyboard.type("three wibbles");
  await moveFocusTo(
    page,
    page.getByRole("button", { name: lookupCopy.submit }),
    "Tab",
  );
  await page.keyboard.press("Enter");

  await expect(
    page.getByRole("heading", { level: 1, name: en.FindPage.notFoundHeading }),
  ).toBeVisible();

  // Again from the not-found page, with Enter in the field this time.
  const again = page.getByRole("searchbox", { name: lookupCopy.label });
  await moveFocusTo(page, again, "Tab");
  await page.keyboard.press("ControlOrMeta+A");
  await page.keyboard.press("Backspace");
  await page.keyboard.type("ice cube ice cube ice cube");
  await page.keyboard.press("Enter");

  await expect(page).toHaveURL("/ice-cube.ice-cube.ice-cube");

  expect(
    await page.evaluate(() => window.keyboardOnlyPointerEvents ?? null),
  ).toEqual([]);
});

test("a visitor fills, swaps and reaches the claim form by keyboard alone", async ({
  page,
}) => {
  const seeded = await seedClaimedHandle();
  const picked = seeded.emoji.map((entry) => entry.emoji);

  await page.addInitScript((events: readonly string[]) => {
    window.keyboardOnlyPointerEvents = [];
    const record = (event: Event) => {
      window.keyboardOnlyPointerEvents?.push(event.type);
    };
    for (const type of events) {
      window.addEventListener(type, record, { capture: true });
    }
    // A keyboard activation dispatches a click too, with a click count of 0;
    // only a pointer's click carries a positive one.
    window.addEventListener(
      "click",
      (event) => {
        if (event.detail > 0) record(event);
      },
      { capture: true },
    );
  }, POINTER_EVENTS);

  await page.goto("/");

  const search = page.getByRole("searchbox", {
    name: builderCopy.pickerSearchLabel,
  });
  const grid = page.getByRole("list");

  // Fill three slots. The first move starts from the top of the document; the
  // next two go back up from the emoji just picked.
  for (const [position, entry] of seeded.emoji.entries()) {
    await moveFocusTo(page, search, position === 0 ? "Tab" : "Shift+Tab");
    await page.keyboard.press("ControlOrMeta+A");
    await page.keyboard.press("Backspace");
    await page.keyboard.type(entry.displayName);

    const result = grid.getByRole("button", {
      name: entry.displayName,
      exact: true,
    });
    await moveFocusTo(page, result, "Tab");
    await page.keyboard.press("Enter");

    await expect(slotButton(page, position)).toHaveAccessibleName(
      filledSlotName(position, entry.displayName),
    );
    // Picking leaves focus where it was: on the emoji, never on <body>.
    await expect(result).toBeFocused();
    await expectFocusShown(page);
  }

  // The seeded Handle is taken, so the builder offers swaps.
  await expect(page.getByText(builderCopy.stateClaimed)).toBeVisible();
  const suggestions = swapSuggestions({ emoji: picked });
  const chosen = suggestions.at(-1);
  if (chosen === undefined) {
    throw new Error(`The domain offers no swap for ${picked.join("")}.`);
  }
  const swapped = chosen.handle.emoji.map((entry) => entry.emoji);
  const suggestion = page
    .getByRole("group", { name: builderCopy.swapHeading })
    .getByRole("button", {
      name: builderCopy.swapSuggestion.replace(
        "{spoken}",
        spokenHandle(swapped) ?? swapped.join(""),
      ),
      exact: true,
    });

  // The suggestions sit above the picker, so the last one is the first that
  // Shift+Tab reaches from the grid.
  await moveFocusTo(page, suggestion, "Shift+Tab");

  const changedSlot = slotButton(page, chosen.position);
  const slotUnfocused = await styleOf(changedSlot);
  await page.keyboard.press("Enter");

  // The suggestion that had focus is gone; focus is on the slot it changed.
  const newName = nameOf(swapped[chosen.position] ?? "");
  await expect(changedSlot).toHaveAccessibleName(
    filledSlotName(chosen.position, newName),
  );
  await expectFocusIndicated(page, changedSlot, slotUnfocused);

  // A suggestion is well-formed and not Reserved, not proven free; say so if
  // this one happens to be taken rather than failing somewhere later.
  await expect(
    page.getByText(builderCopy.stateAvailable),
    "the swapped Handle should be free in a fresh database",
  ).toBeVisible();
  await expect(suggestion).toHaveCount(0);
  // Still on the slot once the suggestions have unmounted.
  await expect(changedSlot).toBeFocused();
  await expectFocusShown(page);

  // On to the claim form, which follows the builder.
  const email = page.getByRole("textbox", { name: claimCopy.claimEmailLabel });
  await moveFocusTo(page, email, "Tab");
  await page.keyboard.type("keyboard-only@example.com");
  await expect(email).toHaveValue("keyboard-only@example.com");

  await moveFocusTo(page, page.getByLabel(claimCopy.claimPasswordLabel), "Tab");
  await moveFocusTo(
    page,
    page.getByRole("button", { name: claimCopy.claimSubmit }),
    "Tab",
  );

  expect(
    await page.evaluate(() => window.keyboardOnlyPointerEvents ?? null),
  ).toEqual([]);
});
