import { expect, test, type Locator, type Page } from "@playwright/test";
import { spokenHandle, type CuratedEmoji } from "@template/core";
import en from "../../../packages/shared/messages/en.json";
import { checkPage, PAGE_RULES, type PageReport } from "./support/axe";
import { categoryTabs, emojiGrid, pickEmoji } from "./support/picker";
import { drawUnclaimedHandle, pathOf } from "./support/unclaimed-handle";

/**
 * The connected layout, in the real browser
 * ([#263](https://github.com/joshstothard/3moji/issues/263)).
 *
 * **On a wide screen** (`chromium`, 1280px) the home page is a centred hero,
 * then one composer card: the slot row, sticky within the card, the category
 * tabs and the grid, and step 2 at the bottom, locked until the Handle is
 * complete and available. **On a phone** (`Mobile Chrome`, a 412px Pixel 7) a
 * compact Handle bar and the tabs stick under the header while browsing, and a
 * complete, available Handle opens the claim sheet, a modal dialog.
 *
 * jsdom evaluates no CSS and has no top layer, so the unit suites
 * (`handle-composer.test.tsx`, `claim-sheet.test.tsx`) prove the tree and the
 * builder's side of the sheet; this is where stickiness is measured, where the
 * dialog is shown to be modal and the page behind it inert, and where focus is
 * shown never to be hidden under the sticky bars (WCAG 2.4.11).
 *
 * Every Handle is drawn at random, as `accessibility.spec.ts` draws one, so it
 * is free in the shared database and nothing here claims it.
 */

const copy = en.HandleBuilder;
const claimCopy = en.Claim;
const lookupCopy = en.HandleLookup;

/** How far apart two edges may be and still meet, in CSS pixels. */
const EDGE = 2;

/** Brand colours as Chromium reports a computed colour. */
const VIOLET = "rgb(91, 61, 245)";
const PAPER = "rgb(251, 248, 244)";
const WHITE = "rgb(255, 255, 255)";

function composer(page: Page): Locator {
  return page.locator("[data-composer]");
}

function slotBar(page: Page): Locator {
  return page.locator("[data-composer-bar]");
}

/**
 * The bar's slot buttons, by structure rather than by role: while the sheet is
 * open the bar is inert, and it is the bar's own slots a spec means.
 */
function barSlots(page: Page): Locator {
  return slotBar(page).locator("[role='group'] button");
}

/** The sticky bar's Claim button (#272), offered once the sheet is dismissed. */
function barClaim(page: Page): Locator {
  return slotBar(page).getByRole("button", { name: copy.barClaim });
}

declare global {
  interface Window {
    __composerShifts?: number[];
  }
}

function tabsRow(page: Page): Locator {
  return page.locator("[data-picker-tabs]");
}

function claimStep(page: Page): Locator {
  return page.locator("[data-claim-step]");
}

function sheet(page: Page): Locator {
  return page.getByRole("dialog", { name: claimCopy.claimHeading });
}

function siteHeader(page: Page): Locator {
  return page.locator("nav").first();
}

async function boxOf(
  locator: Locator,
): Promise<{ x: number; y: number; width: number; height: number }> {
  const box = await locator.boundingBox();
  if (box === null) throw new Error("the element has no box");
  return box;
}

async function bottomOf(locator: Locator): Promise<number> {
  const box = await boxOf(locator);
  return box.y + box.height;
}

async function openHome(page: Page): Promise<void> {
  await page.goto("/");
  await expect(categoryTabs(page).first()).toBeVisible();
}

async function buildAvailableHandle(
  page: Page,
): Promise<readonly CuratedEmoji[]> {
  const entries = drawUnclaimedHandle();
  for (const entry of entries) {
    await pickEmoji(page, entry);
  }
  await expect(
    page.getByText(copy.stateAvailable, { exact: true }),
  ).toBeVisible();
  return entries;
}

async function scrollGridToEnd(page: Page): Promise<void> {
  await emojiGrid(page)
    .getByRole("button")
    .last()
    .evaluate((element) => {
      element.scrollIntoView({ block: "end" });
    });
}

async function animationsSettle(locator: Locator): Promise<void> {
  await locator.evaluate(async (element) => {
    await Promise.all(
      element.getAnimations({ subtree: true }).map((each) => each.finished),
    );
  });
}

/**
 * How many "Your Handle" slot groups Chromium's own accessibility tree exposes.
 * An inert subtree is in the DOM but ignored here, which is the property the
 * issue asks for: one set of slot controls in the tree at a time.
 */
async function slotGroupsInAccessibilityTree(page: Page): Promise<number> {
  const session = await page.context().newCDPSession(page);
  try {
    const { nodes } = await session.send("Accessibility.getFullAXTree");
    return nodes.filter(
      (node) =>
        !node.ignored &&
        node.role?.value === "group" &&
        node.name?.value === copy.slotsLabel,
    ).length;
  } finally {
    await session.detach();
  }
}

function expectAccessible(report: PageReport, rules: readonly string[]): void {
  expect(report.violations, "axe violations").toEqual([]);
  expect(report.incomplete, "axe incomplete results").toEqual([]);
  expect(report.passed, "rules that ran and passed").toEqual(
    expect.arrayContaining([...rules]),
  );
}

test.describe("on a wide screen", () => {
  test.skip(
    ({ isMobile }) => isMobile,
    "The phone layout is proved in the describe below.",
  );

  test("the composer is one centred card of about 1000px, below a centred hero and above Find a Handle", async ({
    page,
  }) => {
    await openHome(page);
    const width = await page.evaluate(
      () => document.documentElement.clientWidth,
    );
    const card = await boxOf(composer(page));

    expect(card.width).toBeGreaterThan(900);
    expect(card.width).toBeLessThanOrEqual(1000 + EDGE);
    expect(
      Math.abs(card.x - (width - card.x - card.width)),
      "the card is centred",
    ).toBeLessThanOrEqual(EDGE);

    const heading = page.getByRole("heading", { level: 1 });
    await expect(heading).toHaveCSS("text-align", "center");
    expect(await bottomOf(heading)).toBeLessThan(card.y);

    // Find a Handle waited below the composer until the header search (#254)
    // replaced it.
    await expect(
      page.getByRole("search", { name: lookupCopy.heading }),
    ).toHaveCount(0);
  });

  test("a tablet gets the same composer, at full width", async ({ page }) => {
    await page.setViewportSize({ width: 820, height: 1180 });
    await openHome(page);
    const width = await page.evaluate(
      () => document.documentElement.clientWidth,
    );

    // The page's own padding is 2rem a side from `sm`.
    expect((await boxOf(composer(page))).width).toBeGreaterThanOrEqual(
      width - 64 - EDGE,
    );
    await expect(slotBar(page)).toHaveCSS("position", "sticky");
    await expect(slotBar(page)).toHaveCSS("top", "80px");
    await expect(tabsRow(page)).toHaveCSS("position", "static");
  });

  test("the slot row stays in view under the header while the grid scrolls", async ({
    page,
  }) => {
    await openHome(page);
    const headerBottom = await bottomOf(siteHeader(page));
    const resting = await boxOf(slotBar(page));
    expect(resting.y, "the row starts below the hero").toBeGreaterThan(
      headerBottom + 100,
    );

    await scrollGridToEnd(page);

    expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(
      resting.y,
    );
    await expect
      .poll(async () => Math.abs((await boxOf(slotBar(page))).y - headerBottom))
      .toBeLessThanOrEqual(EDGE);
    await expect(barSlots(page).first()).toBeInViewport();
    await expect(
      slotBar(page).getByText(copy.spokenEmpty, { exact: true }),
    ).toBeInViewport();
  });

  test("step 2 looks inactive until the Handle is complete, and opens with the claim form once it is available", async ({
    page,
  }) => {
    await openHome(page);

    await expect(claimStep(page)).toHaveAttribute("data-claim-step", "locked");
    await expect(
      claimStep(page).getByText(copy.stepLocked, { exact: true }),
    ).toBeVisible();
    await expect(claimStep(page).getByRole("textbox")).toHaveCount(0);
    await expect(claimStep(page)).toHaveCSS("background-color", PAPER);
    expectAccessible(await checkPage(page), [
      ...PAGE_RULES,
      "button-name",
      "list",
    ]);

    await buildAvailableHandle(page);

    await expect(claimStep(page)).toHaveAttribute("data-claim-step", "open");
    await expect(claimStep(page)).toHaveCSS("background-color", WHITE);
    await expect(
      claimStep(page).getByRole("textbox", { name: claimCopy.claimEmailLabel }),
    ).toBeVisible();
    await expect(sheet(page)).toHaveCount(0);
    // The bar's Claim button is a phone's control (#272).
    await expect(barClaim(page)).toHaveCount(0);
    await animationsSettle(claimStep(page));
    // Picking scrolled the grid up under the sticky slot row, and axe cannot
    // work out the colour behind text that overlaps other content, so the
    // page is checked from the top, as the locked state was.
    await page.evaluate(() => {
      window.scrollTo(0, 0);
    });
    expectAccessible(await checkPage(page), [
      ...PAGE_RULES,
      "label",
      "button-name",
      "autocomplete-valid",
    ]);
  });
});

test.describe("on a phone", () => {
  test.skip(
    ({ isMobile }) => !isMobile,
    "The wide layout is proved in the describe above.",
  );

  test("while browsing, the Handle bar sticks under the header with the slots, how far along it is, and the tabs", async ({
    page,
  }) => {
    await openHome(page);
    const [first] = drawUnclaimedHandle();
    if (first === undefined) throw new Error("no emoji drawn");
    await pickEmoji(page, first);

    await expect(
      slotBar(page).getByText(copy.pickTwoMore, { exact: true }),
    ).toBeVisible();
    await expect(
      barSlots(page).first().locator("[data-remove-badge]"),
    ).toBeVisible();

    await page.evaluate(() => {
      window.scrollTo(0, 0);
    });
    const headerBottom = await bottomOf(siteHeader(page));
    expect((await boxOf(slotBar(page))).y).toBeGreaterThan(headerBottom + 50);
    expectAccessible(await checkPage(page), [
      ...PAGE_RULES,
      "button-name",
      "list",
    ]);

    await scrollGridToEnd(page);

    expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(300);
    await expect
      .poll(async () => Math.abs((await boxOf(slotBar(page))).y - headerBottom))
      .toBeLessThanOrEqual(EDGE);
    await expect(barSlots(page).first()).toBeInViewport();
    await expect(categoryTabs(page).first()).toBeInViewport();
    expect(
      Math.abs(
        (await boxOf(tabsRow(page))).y - (await bottomOf(slotBar(page))),
      ),
      "the tabs stick straight under the bar",
    ).toBeLessThanOrEqual(EDGE);
    expect(await slotGroupsInAccessibilityTree(page)).toBe(1);
  });

  test("nothing violet shows just under the header while the page scrolls (#253's iPhone report)", async ({
    page,
  }) => {
    await openHome(page);
    const headerBottom = await bottomOf(siteHeader(page));
    const scrollHeight = await page.evaluate(
      () => document.documentElement.scrollHeight,
    );

    for (let offset = 0; offset < scrollHeight; offset += 150) {
      await page.evaluate((y) => {
        window.scrollTo(0, y);
      }, offset);
      const under = await page.evaluate((y) => {
        const width = document.documentElement.clientWidth;
        return [0.08, 0.5, 0.92].map((fraction) => {
          const hit = document.elementFromPoint(width * fraction, y);
          let element: Element | null = hit;
          let background = "none";
          while (element !== null) {
            const colour = getComputedStyle(element).backgroundColor;
            if (colour !== "rgba(0, 0, 0, 0)") {
              background = colour;
              break;
            }
            element = element.parentElement;
          }
          return { y: window.scrollY, tag: hit?.tagName ?? null, background };
        });
      }, headerBottom + 1);

      for (const point of under) {
        expect(point.background, JSON.stringify(point)).not.toBe(VIOLET);
      }
    }
  });

  test("a complete, available Handle opens the claim sheet: a modal dialog, focus inside and kept there, the page behind it inert", async ({
    page,
  }) => {
    await openHome(page);
    const entries = await buildAvailableHandle(page);
    const dialog = sheet(page);

    await expect(dialog).toBeVisible();
    expect(await dialog.evaluate((element) => element.matches(":modal"))).toBe(
      true,
    );
    await expect(
      dialog.getByRole("button", { name: copy.sheetClose }),
    ).toBeFocused();
    await expect(composer(page)).toHaveAttribute("inert", "");
    expect(await slotGroupsInAccessibilityTree(page)).toBe(1);

    const glyphs = entries.map((entry) => entry.emoji);
    const spoken = spokenHandle(glyphs) ?? glyphs.join("");
    await expect(
      dialog.getByRole("group", { name: copy.slotsLabel }).getByRole("button"),
    ).toHaveCount(3);
    await expect(
      dialog.getByText(copy.spoken.replace("{spoken}", spoken), {
        exact: true,
      }),
    ).toBeVisible();
    await expect(dialog.getByRole("img", { name: spoken })).toBeVisible();
    await expect(
      dialog.getByText(copy.sheetAvailable, { exact: true }),
    ).toBeVisible();
    await expect(
      dialog.getByRole("textbox", { name: claimCopy.claimEmailLabel }),
    ).toBeVisible();

    for (const key of ["Tab", "Shift+Tab"] as const) {
      for (let press = 0; press < 16; press += 1) {
        await page.keyboard.press(key);
        expect(
          await dialog.evaluate((element) =>
            element.contains(document.activeElement),
          ),
          `${key} ${String(press + 1)} kept focus in the sheet`,
        ).toBe(true);
      }
    }

    await animationsSettle(dialog);
    const report = await checkPage(page, { include: "dialog[open]" });
    expectAccessible(report, ["label", "button-name"]);
  });

  test("Escape and the close control each dismiss the sheet and put focus back on the slot bar, and it opens again on request", async ({
    page,
  }) => {
    await openHome(page);
    await buildAvailableHandle(page);
    const dialog = sheet(page);
    await expect(dialog).toBeVisible();

    await page.keyboard.press("Escape");

    await expect(dialog).toBeHidden();
    await expect(barClaim(page)).toBeFocused();
    await expect(composer(page)).not.toHaveAttribute("inert");
    expect(await slotGroupsInAccessibilityTree(page)).toBe(1);

    await barClaim(page).click();
    await expect(dialog).toBeVisible();

    await dialog.getByRole("button", { name: copy.sheetClose }).click();

    await expect(dialog).toBeHidden();
    await expect(barClaim(page)).toBeFocused();
  });

  test("once the sheet is dismissed, the Claim button in the sticky Handle bar opens it again without scrolling, and nothing moves (#272)", async ({
    page,
  }) => {
    await openHome(page);
    await buildAvailableHandle(page);
    const dialog = sheet(page);
    await expect(dialog).toBeVisible();
    await expect(barClaim(page)).toHaveCount(0);
    const barHeight = (await boxOf(slotBar(page))).height;

    // Every layout shift from here on, input or not: the button appearing and
    // the sheet opening must move nothing at all.
    await page.evaluate(() => {
      const shifts: number[] = [];
      window.__composerShifts = shifts;
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          shifts.push((entry as PerformanceEntry & { value: number }).value);
        }
      }).observe({ type: "layout-shift" });
    });

    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(barClaim(page)).toBeFocused();
    expect((await boxOf(slotBar(page))).height).toBe(barHeight);

    await page.evaluate(() => {
      window.scrollTo(0, 0);
    });
    expectAccessible(await checkPage(page), [...PAGE_RULES, "button-name"]);

    // Browsing the grid: step 2 and its own button are out of view, and the
    // bar's Claim button is still on screen.
    await emojiGrid(page)
      .getByRole("button")
      .first()
      .evaluate((element) => {
        element.scrollIntoView({ block: "center" });
      });
    await expect(
      page.getByRole("button", { name: copy.sheetReopen }),
    ).not.toBeInViewport();
    await expect(barClaim(page)).toBeInViewport();
    const scrolled = await page.evaluate(() => window.scrollY);

    await barClaim(page).tap();

    await expect(dialog).toBeVisible();
    expect(await page.evaluate(() => window.scrollY)).toBe(scrolled);
    await expect(
      dialog.getByRole("button", { name: copy.sheetClose }),
    ).toBeFocused();
    expect(
      await dialog.evaluate((element) =>
        element.contains(document.activeElement),
      ),
    ).toBe(true);
    const shifts = await page.evaluate(() => window.__composerShifts ?? []);
    console.log(`layout shifts, dismiss to reopen: ${JSON.stringify(shifts)}`);
    expect(shifts.reduce((sum, value) => sum + value, 0)).toBe(0);
  });

  test("removing an emoji from the sheet closes it and goes back to browsing", async ({
    page,
  }) => {
    await openHome(page);
    await buildAvailableHandle(page);
    const dialog = sheet(page);
    await expect(dialog).toBeVisible();

    await dialog
      .getByRole("group", { name: copy.slotsLabel })
      .getByRole("button")
      .nth(1)
      .click();

    await expect(dialog).toBeHidden();
    const emptied = barSlots(page).nth(1);
    await expect(emptied).toHaveAccessibleName(
      copy.slotEmpty.replace("{position}", "2"),
    );
    await expect(emptied).toBeFocused();
    await expect(
      slotBar(page).getByText(copy.pickOneMore, { exact: true }),
    ).toBeVisible();
  });
});

test("keyboard focus moving through the grid is never hidden under the header or the sticky bars (WCAG 2.4.11)", async ({
  page,
}) => {
  await openHome(page);
  const presses = Math.min(
    await emojiGrid(page).getByRole("button").count(),
    45,
  );
  await categoryTabs(page).last().focus();

  let checked = 0;
  for (const key of ["Tab", "Shift+Tab"] as const) {
    for (let press = 0; press < presses; press += 1) {
      await page.keyboard.press(key);
      const report = await page.evaluate(() => {
        const focused = document.activeElement;
        if (!(focused instanceof HTMLElement)) return null;
        if (focused.closest("[data-composer] ul") === null) return null;
        const rect = focused.getBoundingClientRect();
        const hit = document.elementFromPoint(
          rect.left + rect.width / 2,
          rect.top + rect.height / 2,
        );
        return {
          name: focused.getAttribute("aria-label"),
          top: Math.round(rect.top),
          covered: hit === null || !focused.contains(hit),
          by: hit === null ? null : hit.tagName,
        };
      });
      if (report === null) break;
      expect(report.covered, JSON.stringify(report)).toBe(false);
      checked += 1;
    }
  }
  expect(checked, "focus stops checked").toBeGreaterThan(40);
});

test.describe("the moment step 2 unlocks (#272)", () => {
  test.skip(
    ({ isMobile }) => isMobile,
    "On a phone the claim form opens in the sheet rather than in step 2.",
  );

  test("the email field can be clicked and focused straight after the third pick", async ({
    page,
  }) => {
    await openHome(page);
    const entries = drawUnclaimedHandle();
    for (const entry of entries) {
      await pickEmoji(page, entry);
    }

    const email = claimStep(page).getByRole("textbox", {
      name: claimCopy.claimEmailLabel,
    });
    await expect(email).toBeAttached();

    // Read the instant the field is there: nothing that holds it may be moving
    // it, and its box must not change between frames. The unlock's motion is
    // decorative, a glow on step 2's edge, so it never moves the controls.
    const report = await email.evaluate(async (field) => {
      const MOVES = [
        "transform",
        "translate",
        "scale",
        "rotate",
        "top",
        "left",
        "right",
        "bottom",
        "margin",
        "marginTop",
        "marginLeft",
        "height",
        "width",
      ];
      const moving = document
        .getAnimations()
        .filter((animation) => {
          if (
            animation.playState !== "running" ||
            !(animation.effect instanceof KeyframeEffect)
          ) {
            return false;
          }
          const holdsField = animation.effect.target?.contains(field) === true;
          const moves = animation.effect
            .getKeyframes()
            .some((frame) => MOVES.some((property) => property in frame));
          return holdsField && moves;
        })
        .map((animation) =>
          animation instanceof CSSAnimation
            ? animation.animationName
            : animation.constructor.name,
        );
      const before = field.getBoundingClientRect();
      await new Promise<void>((resolve) => {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            resolve();
          });
        });
      });
      const after = field.getBoundingClientRect();
      return {
        moving,
        moved:
          Math.abs(before.top - after.top) + Math.abs(before.left - after.left),
      };
    });
    console.log(`step 2 at unlock: ${JSON.stringify(report)}`);
    expect(report.moving, "animations moving the email field").toEqual([]);
    expect(report.moved, "pixels the email field moved in two frames").toBe(0);

    // Playwright clicks only a stable element, so a short timeout fails while
    // the field is still sliding into place.
    await email.click({ timeout: 150 });
    await expect(email).toBeFocused();
  });
});

test.describe("/#claim once the phone's sheet is dismissed (#272)", () => {
  test.skip(
    ({ isMobile }) => !isMobile,
    "Only a phone moves the claim form into the sheet.",
  );

  test("following the page's own link to #claim, twice, reaches the claim again", async ({
    page,
  }) => {
    await page.goto(pathOf(drawUnclaimedHandle()));
    const dialog = sheet(page);
    await expect(dialog).toBeVisible();

    const action = page.getByRole("link", {
      name: en.HandlePage.unclaimedAction,
    });

    for (let attempt = 1; attempt <= 2; attempt += 1) {
      await page.keyboard.press("Escape");
      await expect(dialog).toBeHidden();
      await page.evaluate(() => {
        window.scrollTo(0, 0);
      });

      await action.click();

      // Either the sheet opens again, or the fragment lands on something in
      // view that the visitor can use to claim: never on nothing.
      await expect
        .poll(
          async () =>
            page.evaluate(() => {
              if (document.querySelector("dialog[open]") !== null) {
                return "the sheet opened";
              }
              const target = document.getElementById("claim");
              if (target === null) return "no #claim target";
              const rect = target.getBoundingClientRect();
              if (rect.bottom <= 0 || rect.top >= window.innerHeight) {
                return "#claim is out of view";
              }
              if (
                target.closest("[inert]") !== null ||
                target.querySelector("button, input") === null
              ) {
                return "#claim holds nothing usable";
              }
              return "#claim is in view and usable";
            }),
          { message: `attempt ${String(attempt)}` },
        )
        .toMatch(/^(the sheet opened|#claim is in view and usable)$/);
    }
  });
});

test.describe("without JavaScript", () => {
  test.use({ javaScriptEnabled: false });

  test("an unclaimed Handle's page renders the claim form inline in step 2, and no sheet", async ({
    page,
  }) => {
    await page.goto(pathOf(drawUnclaimedHandle()));

    await expect(claimStep(page)).toHaveAttribute("data-claim-step", "open");
    await expect(
      claimStep(page).getByRole("textbox", { name: claimCopy.claimEmailLabel }),
    ).toBeVisible();
    await expect(page.locator("dialog")).toHaveCount(0);
  });

  test("the home page renders the composer with step 2 locked", async ({
    page,
  }) => {
    await page.goto("/");

    await expect(composer(page)).toBeVisible();
    await expect(claimStep(page)).toHaveAttribute("data-claim-step", "locked");
    await expect(page.locator("dialog")).toHaveCount(0);
  });
});
