import { expect, test, type Locator, type Page } from "@playwright/test";
import en from "../../../packages/shared/messages/en.json";
import { checkPage, PAGE_RULES } from "./support/axe";
import { describeContrast, measureContrast } from "./support/contrast";

/**
 * The rare three-of-a-kind celebration, in the real browser
 * ([#202](https://github.com/joshstothard/3moji/issues/202)).
 *
 * jsdom evaluates no CSS, so this is where the motion is proved: that an
 * available three-of-a-kind plays a short animation that runs once, that it
 * plays again on a return to the triple, that `prefers-reduced-motion: reduce`
 * gets no motion at all and only the static badge, and that the badge meets
 * text contrast and the page still passes axe with it showing. When it appears
 * and what is announced are proved in `handle-builder.test.tsx`.
 *
 * 🧊🧊🧊 is the available triple: nothing claims it in the shared E2E database
 * (`handle-url.spec.ts` relies on the same), and 🍕🍕🍕 is the reserved demo
 * Handle, so its answer holds with or without a database.
 */

const copy = en.HandleBuilder;

/** WCAG 1.4.3 Contrast (Minimum), for text at normal size. */
const TEXT_CONTRAST = 4.5;

/** The longest a celebration may take, delay included, in milliseconds. */
const MAX_CELEBRATION_MS = 1000;

/** What the browser reports about one running or filled animation. */
interface AnimationReport {
  readonly name: string;
  readonly iterations: number | null;
  /** Delay plus one iteration's duration, in milliseconds. */
  readonly totalMs: number | null;
}

function builder(page: Page): Locator {
  return page.getByRole("region", { name: copy.builderHeading });
}

function badge(page: Page): Locator {
  // The badge is hidden from assistive technology, which hears the live region
  // instead, so it is found by its text rather than by role.
  return builder(page).getByText(copy.rareBadge, { exact: true });
}

function announcement(page: Page): Locator {
  return page.locator("[data-rare-announcement]");
}

async function pickByName(page: Page, name: string): Promise<void> {
  await page
    .getByRole("searchbox", { name: copy.pickerSearchLabel })
    .fill(name);
  await page.getByRole("button", { name, exact: true }).click();
}

async function buildTriple(
  page: Page,
  name: string,
  answer: string,
): Promise<void> {
  await page.goto("/");
  await expect(
    page.getByRole("searchbox", { name: copy.pickerSearchLabel }),
  ).toBeVisible();
  for (let picked = 0; picked < 3; picked += 1) {
    await pickByName(page, name);
  }
  await expect(page.getByText(answer)).toBeVisible();
}

/**
 * Every CSS animation on the builder. An animation that has finished but fills
 * forwards is still reported, so a slow run cannot empty this list before it is
 * read.
 */
async function animationsIn(target: Locator): Promise<AnimationReport[]> {
  return target.evaluate((element) =>
    element.getAnimations({ subtree: true }).map((animation) => {
      const timing = animation.effect?.getComputedTiming();
      const duration = timing?.duration;
      return {
        name:
          animation instanceof CSSAnimation
            ? animation.animationName
            : animation.constructor.name,
        iterations: timing?.iterations ?? null,
        totalMs:
          typeof duration === "number" ? (timing?.delay ?? 0) + duration : null,
      };
    }),
  );
}

async function animationsFinish(target: Locator): Promise<void> {
  await target.evaluate(async (element) => {
    await Promise.all(
      element.getAnimations({ subtree: true }).map((each) => each.finished),
    );
  });
}

test("an available three-of-a-kind plays a short celebration once and shows the rare badge", async ({
  page,
}) => {
  await buildTriple(page, "ice cube", copy.stateAvailable);

  await expect(badge(page)).toBeVisible();
  await expect(announcement(page)).toHaveText(copy.rareAnnouncement);
  await expect(announcement(page)).toHaveAttribute("aria-live", "polite");

  const animations = await animationsIn(builder(page));
  console.log(`rare celebration animations: ${JSON.stringify(animations)}`);
  expect(animations.map((each) => each.name).sort()).toEqual([
    "rare-hop",
    "rare-hop",
    "rare-hop",
    "rare-pop",
  ]);
  for (const animation of animations) {
    // Once, never `infinite`, and done within a second.
    expect(animation.iterations, animation.name).toBe(1);
    expect(animation.totalMs, animation.name).not.toBeNull();
    expect(animation.totalMs ?? Infinity, animation.name).toBeLessThanOrEqual(
      MAX_CELEBRATION_MS,
    );
  }
});

test("the celebration plays again when the visitor changes away and back", async ({
  page,
}) => {
  await buildTriple(page, "ice cube", copy.stateAvailable);
  await expect(badge(page)).toBeVisible();
  await animationsFinish(builder(page));
  await badge(page).evaluate((element) => {
    element.setAttribute("data-e2e-first-badge", "");
  });

  await page
    .getByRole("button", {
      name: copy.slotFilled
        .replace("{position}", "3")
        .replace("{name}", "ice cube"),
    })
    .click();
  await expect(badge(page)).toHaveCount(0);
  await expect(announcement(page)).toHaveText("");
  expect(await animationsIn(builder(page))).toEqual([]);

  await pickByName(page, "ice cube");
  await expect(page.getByText(copy.stateAvailable)).toBeVisible();
  await expect(badge(page)).toBeVisible();

  // A fresh badge, not the old one shown again, with the celebration on it.
  await expect(builder(page).locator("[data-e2e-first-badge]")).toHaveCount(0);
  const replayed = await animationsIn(builder(page));
  expect(replayed.map((each) => each.name)).toContain("rare-pop");
  expect(replayed.filter((each) => each.name === "rare-hop")).toHaveLength(3);
});

test("under reduced motion there is no animation, only the static rare badge", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await buildTriple(page, "ice cube", copy.stateAvailable);

  await expect(badge(page)).toBeVisible();
  await expect(announcement(page)).toHaveText(copy.rareAnnouncement);
  expect(await animationsIn(builder(page))).toEqual([]);
  await expect(badge(page)).toHaveCSS("animation-name", "none");
  await expect(badge(page)).toHaveCSS("transform", "none");
});

test("the rare badge meets text contrast, and the builder passes axe with it showing", async ({
  page,
}) => {
  await buildTriple(page, "ice cube", copy.stateAvailable);
  await expect(badge(page)).toBeVisible();
  // Measured at rest: the celebration moves the badge but never fades it.
  await animationsFinish(builder(page));

  const measured = await measureContrast(badge(page));
  const account = describeContrast("rare badge", measured);
  console.log(account);
  expect(measured.ratio, account).toBeGreaterThanOrEqual(TEXT_CONTRAST);

  const report = await checkPage(page);
  expect(report.violations, "axe violations").toEqual([]);
  expect(report.incomplete, "axe incomplete results").toEqual([]);
  expect(report.passed, "rules that ran and passed").toEqual(
    expect.arrayContaining([...PAGE_RULES, "button-name"]),
  );
});

test("a reserved three-of-a-kind is not celebrated", async ({ page }) => {
  await buildTriple(page, "pizza", copy.stateNotClaimable);

  await expect(badge(page)).toHaveCount(0);
  await expect(announcement(page)).toHaveText("");
  expect(await animationsIn(builder(page))).toEqual([]);
});
