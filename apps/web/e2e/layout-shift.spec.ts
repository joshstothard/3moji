import { expect, test, type Page } from "@playwright/test";
import en from "../../../packages/shared/messages/en.json";
import { expectHydrated } from "./support/csp";
import { categoryTabs, pickEmoji } from "./support/picker";
import { drawUnclaimedHandle, pathOf } from "./support/unclaimed-handle";

/**
 * The page does not jump when JavaScript takes over on a phone
 * ([#272](https://github.com/joshstothard/3moji/issues/272)).
 *
 * The server renders the claim form inline in step 2 on every width, so the
 * page works without JavaScript. On a phone, hydration then moves the form
 * into the claim sheet (#263). Whatever step 2 shows after that has to take
 * the same room, or everything below it moves.
 *
 * Measured as the browser measures it: every `layout-shift` entry the
 * `PerformanceObserver` reports from the first paint, less those within
 * 500 ms of input (`hadRecentInput`). The total is summed across the whole
 * load rather than windowed, so it is an upper bound on Cumulative Layout
 * Shift. The load is the only thing measured: no pointer or key is used.
 */

const claimCopy = en.Claim;
const builderCopy = en.HandleBuilder;

/** "Good" Cumulative Layout Shift, per web.dev. */
const GOOD_CLS = 0.1;

interface ShiftReport {
  readonly total: number;
  readonly entries: readonly {
    readonly value: number;
    readonly sources: readonly string[];
  }[];
}

declare global {
  interface Window {
    __layoutShifts?: { value: number; sources: string[] }[];
  }
}

/** Starts recording shifts before any of the page's own script runs. */
async function recordLayoutShifts(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const shifts: { value: number; sources: string[] }[] = [];
    window.__layoutShifts = shifts;
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        const shift = entry as PerformanceEntry & {
          value: number;
          hadRecentInput: boolean;
          sources?: readonly { node?: Node | null }[];
        };
        if (shift.hadRecentInput) continue;
        shifts.push({
          value: shift.value,
          sources: (shift.sources ?? []).map((source) => {
            const node = source.node;
            if (!(node instanceof Element)) return String(node?.nodeName);
            const marker = Array.from(node.attributes)
              .filter((attribute) => attribute.name.startsWith("data-"))
              .map((attribute) => attribute.name)
              .join(",");
            return `${node.tagName.toLowerCase()}${marker === "" ? "" : `[${marker}]`}`;
          }),
        });
      }
    }).observe({ type: "layout-shift", buffered: true });
  });
}

/** Lets two frames and a short pause pass, so a late shift is reported. */
async function settle(page: Page): Promise<void> {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            setTimeout(resolve, 500);
          });
        });
      }),
  );
}

async function shiftsSoFar(page: Page): Promise<ShiftReport> {
  const entries = await page.evaluate(() => window.__layoutShifts ?? []);
  return {
    total: entries.reduce((sum, entry) => sum + entry.value, 0),
    entries,
  };
}

/**
 * Holds every script the page asks for until {@link HeldScripts.release}, so a
 * spec can do what a visitor on a slow phone does: read and scroll the
 * server-rendered page before JavaScript takes it over.
 */
interface HeldScripts {
  readonly release: () => void;
}

async function holdScripts(page: Page): Promise<HeldScripts> {
  let release: () => void = () => undefined;
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(
    (url) => url.pathname.endsWith(".js"),
    async (route) => {
      await released;
      await route.continue();
    },
  );
  return { release };
}

/** Scrolls step 2 to the middle of the screen, where a visitor reading it has it. */
async function scrollStepTwoIntoView(page: Page): Promise<void> {
  const step = page.locator("[data-claim-step]");
  await expect(step).toBeVisible();
  await step.evaluate((element) => {
    element.scrollIntoView({ block: "center" });
  });
}

test.describe("on a phone, when JavaScript arrives after the visitor has scrolled to step 2", () => {
  test.skip(
    ({ isMobile }) => !isMobile,
    "The form moves into the sheet only on a phone.",
  );

  test("the home page does not shift as it hydrates", async ({ page }) => {
    await recordLayoutShifts(page);
    const scripts = await holdScripts(page);

    await page.goto("/", { waitUntil: "commit" });
    await scrollStepTwoIntoView(page);
    await settle(page);
    scripts.release();
    await expectHydrated(page);
    await settle(page);

    const report = await shiftsSoFar(page);
    console.log(
      `layout shift on / after scrolling to step 2 (phone): ${JSON.stringify(report)}`,
    );
    expect(report.total).toBeLessThan(GOOD_CLS);
  });

  test("an unclaimed Handle's page does not shift as the claim form moves into the sheet", async ({
    page,
  }) => {
    await recordLayoutShifts(page);
    const scripts = await holdScripts(page);

    await page.goto(pathOf(drawUnclaimedHandle()), { waitUntil: "commit" });
    await scrollStepTwoIntoView(page);
    await settle(page);
    scripts.release();
    await expectHydrated(page);
    await expect(
      page.getByRole("dialog", { name: claimCopy.claimHeading }),
    ).toBeVisible();
    await settle(page);

    const report = await shiftsSoFar(page);
    console.log(
      `layout shift on an unclaimed Handle after scrolling to step 2 (phone): ${JSON.stringify(report)}`,
    );
    expect(report.total).toBeLessThan(GOOD_CLS);
  });
});

test.describe("on a phone, with JavaScript", () => {
  test.skip(
    ({ isMobile }) => !isMobile,
    "The form moves into the sheet only on a phone.",
  );

  test("the home page does not shift as it hydrates", async ({ page }) => {
    await recordLayoutShifts(page);

    await page.goto("/");
    await expectHydrated(page);
    await expect(categoryTabs(page).first()).toBeVisible();
    await settle(page);

    const report = await shiftsSoFar(page);
    console.log(`layout shift on / (phone): ${JSON.stringify(report)}`);
    expect(report.total).toBeLessThan(GOOD_CLS);
  });

  test("an unclaimed Handle's page does not shift as the claim form moves into the sheet", async ({
    page,
  }) => {
    await recordLayoutShifts(page);

    await page.goto(pathOf(drawUnclaimedHandle()));
    await expectHydrated(page);
    await expect(
      page.getByRole("dialog", { name: claimCopy.claimHeading }),
    ).toBeVisible();
    await settle(page);

    const report = await shiftsSoFar(page);
    console.log(
      `layout shift on an unclaimed Handle (phone): ${JSON.stringify(report)}`,
    );
    expect(report.total).toBeLessThan(GOOD_CLS);
  });

  test("an unclaimed Handle's page opened at #claim does not shift as the claim form moves into the sheet", async ({
    page,
  }) => {
    await recordLayoutShifts(page);

    await page.goto(`${pathOf(drawUnclaimedHandle())}#claim`);
    await expectHydrated(page);
    await expect(
      page.getByRole("dialog", { name: claimCopy.claimHeading }),
    ).toBeVisible();
    await settle(page);

    const report = await shiftsSoFar(page);
    console.log(
      `layout shift on an unclaimed Handle at #claim (phone): ${JSON.stringify(report)}`,
    );
    expect(report.total).toBeLessThan(GOOD_CLS);
  });
});

test.describe("on a phone, the sticky Handle bar while the availability answer is slow (#272)", () => {
  test.skip(
    ({ isMobile }) => !isMobile,
    "The bar's Claim button is a phone's control.",
  );

  test("nothing in the bar moves when the answer arrives, when the sheet opens, or when the Claim button appears", async ({
    page,
  }) => {
    // Hold every server action's answer well past the 500 ms after input that
    // Cumulative Layout Shift forgives, so anything the answer moves would
    // count against the page.
    await page.route(
      () => true,
      async (route) => {
        const request = route.request();
        if (
          request.method() === "POST" &&
          request.headers()["next-action"] !== undefined
        ) {
          await new Promise<void>((resolve) => {
            setTimeout(resolve, 1500);
          });
        }
        await route.fallback();
      },
    );

    await page.goto("/");
    await expectHydrated(page);
    await expect(categoryTabs(page).first()).toBeVisible();
    for (const entry of drawUnclaimedHandle()) {
      await pickEmoji(page, entry);
    }
    await expect(
      page.getByText(builderCopy.checking, { exact: true }),
    ).toBeVisible();
    await settle(page);

    // The bar's text, as the browser lays it out, and where the page is.
    const snapshot = () =>
      page.locator("[data-composer-bar] p").evaluateAll((elements) => ({
        scrollY: Math.round(window.scrollY),
        boxes: elements.map((element) => {
          const rect = element.getBoundingClientRect();
          const half = (value: number) => Math.round(value * 2) / 2;
          return [
            half(rect.top),
            half(rect.left),
            half(rect.width),
            half(rect.height),
          ];
        }),
      }));

    const checking = await snapshot();

    await expect(
      page.getByRole("dialog", { name: claimCopy.claimHeading }),
    ).toBeVisible();
    await settle(page);
    const sheetOpen = await snapshot();

    await page.keyboard.press("Escape");
    await expect(
      page
        .locator("[data-composer-bar]")
        .getByRole("button", { name: builderCopy.barClaim }),
    ).toBeVisible();
    await settle(page);
    const claimShowing = await snapshot();

    console.log(
      `bar text boxes (phone): ${JSON.stringify({ checking, sheetOpen, claimShowing })}`,
    );
    expect(sheetOpen, "once the answer arrived and the sheet opened").toEqual(
      checking,
    );
    expect(claimShowing, "once the Claim button appeared").toEqual(checking);
  });
});
