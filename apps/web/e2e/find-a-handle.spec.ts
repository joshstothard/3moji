import { expect, test, type Page } from "@playwright/test";
import {
  curatedEmojiSet,
  findHandleAlias,
  HANDLE_LENGTH,
  resolveAlias,
  type CuratedEmoji,
} from "@template/core";
import en from "../../../packages/shared/messages/en.json";
import { listingAliases } from "./support/aliases";
import { seedClaimedHandle } from "./support/seed";

/**
 * "Find a Handle", end to end
 * ([#200](https://github.com/joshstothard/3moji/issues/200)).
 *
 * A visitor types the words they heard into the home page's lookup and lands
 * on the Handle's Profile, on the listing when several are claimed, or on a
 * clear "no Handle found" — with JavaScript and without it.
 *
 * **Every expected path is the domain's own answer.** Seeded Handles are
 * random, and typed words can have more than one reading, so the spec asks
 * `findHandleAlias` where the words should go rather than assuming the
 * canonical alias; the unit tests pin that function's readings exactly.
 *
 * **The shared database.** Seeds go through `seedClaimedHandle`, which never
 * claims a Handle `handle-url.spec.ts` needs unclaimed, and the listing seeds
 * under `listingAliases()` exactly as `accessibility.spec.ts` does (#187).
 */

const lookupCopy = en.HandleLookup;
const findCopy = en.FindPage;
const handleCopy = en.HandlePage;

const NOT_FOUND_WORDS = "three wibbles";

/** The spoken form Profiles say for 🧊🧊🧊 (#201). */
const SPOKEN_WORDS = "three ice cubes";
const ICE_CUBE_ALIAS = "/ice-cube.ice-cube.ice-cube";
/** The spoken form typed as a path: a 404 under ADR-0008, offering the lookup. */
const SPOKEN_PATH = "/three-ice-cubes";

function randomOf<T>(items: readonly T[]): T {
  const item = items[Math.floor(Math.random() * items.length)];
  if (item === undefined) throw new Error("Nothing to choose from.");
  return item;
}

/** The words a listener would type for `emoji`: the names, space-separated. */
function spokenWordsOf(emoji: readonly CuratedEmoji[]): string {
  return emoji.map((entry) => entry.displayName).join(" ");
}

/**
 * Three emoji whose space-separated names find exactly one Handle, so the
 * lookup can only land on the seeded Profile and never on a listing that
 * another spec's seed happens to complete.
 */
function emojiFoundByTheirWords(): readonly CuratedEmoji[] {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const emoji = Array.from({ length: HANDLE_LENGTH }, () =>
      randomOf(curatedEmojiSet),
    );
    const lookup = findHandleAlias(spokenWordsOf(emoji));
    if (!lookup.found) continue;
    const resolution = resolveAlias(lookup.alias);
    if (resolution.ok && resolution.candidates.length === 1) return emoji;
  }
  throw new Error("No three emoji whose words find exactly one Handle.");
}

function pathOf(words: string): string {
  const lookup = findHandleAlias(words);
  if (!lookup.found) throw new Error(`"${words}" finds no Handle.`);
  return `/${lookup.alias}`;
}

async function lookUp(page: Page, words: string): Promise<void> {
  await page.goto("/");
  await submitLookup(page, words);
}

async function submitLookup(page: Page, words: string): Promise<void> {
  const field = page.getByRole("searchbox", { name: lookupCopy.label });
  await field.fill(words);
  await field.press("Enter");
}

async function expectNotFound(page: Page, words: string): Promise<void> {
  await expect(
    page.getByRole("heading", { level: 1, name: findCopy.notFoundHeading }),
  ).toBeVisible();
  await expect(page.getByText(findCopy.notFound)).toBeVisible();
  await expect(
    page.getByRole("searchbox", { name: lookupCopy.label }),
  ).toHaveValue(words);
}

for (const javaScriptEnabled of [true, false]) {
  test.describe(`with JavaScript ${javaScriptEnabled ? "enabled" : "disabled"}`, () => {
    test.use({ javaScriptEnabled });

    test("typed words take a visitor to the Handle's Profile", async ({
      page,
    }) => {
      const seeded = await seedClaimedHandle({
        chooseEmoji: emojiFoundByTheirWords,
      });
      const words = spokenWordsOf(seeded.emoji);

      await lookUp(page, words);

      await expect(page).toHaveURL(pathOf(words));
      await expect(
        page.getByRole("heading", {
          level: 2,
          name: seeded.profile.displayName,
        }),
      ).toBeVisible();
    });

    test("typed words take a visitor to the listing when several Handles match", async ({
      page,
    }) => {
      const { alias, candidates } = randomOf(listingAliases());
      const chooseEmoji = (): readonly CuratedEmoji[] =>
        randomOf(candidates).emoji;
      const first = await seedClaimedHandle({ chooseEmoji });
      const second = await seedClaimedHandle({ chooseEmoji });

      // The alias's words with spaces, unless those words have a second
      // reading; then as the dotted alias, which the lookup also accepts.
      const spaced = alias.replaceAll(".", " ");
      const words = findHandleAlias(spaced).found ? spaced : alias;

      await lookUp(page, words);

      await expect(page).toHaveURL(pathOf(words));
      const listing = page.getByRole("list", {
        name: handleCopy.aliasListingLabel,
      });
      await expect(listing).toBeVisible();
      for (const seededHandle of [first, second]) {
        await expect(
          listing.locator(`a[href="${seededHandle.path}"]`),
        ).toHaveCount(1);
      }
    });

    test("words that name no Handle say so, and keep what was typed", async ({
      page,
    }) => {
      await lookUp(page, NOT_FOUND_WORDS);

      await expect(page).toHaveURL(/\/find\?q=three\+wibbles$/);
      await expectNotFound(page, NOT_FOUND_WORDS);
    });

    test("the spoken form a Profile says takes a visitor to that Handle (#201)", async ({
      page,
    }) => {
      await lookUp(page, SPOKEN_WORDS);

      await expectIceCubeHandlePage(page);
    });

    test("the spoken path is a 404 that offers the lookup, and its words find the Handle (#201)", async ({
      page,
    }) => {
      const response = await page.goto(SPOKEN_PATH);
      expect(response?.status()).toBe(404);

      await submitLookup(page, SPOKEN_WORDS);

      await expectIceCubeHandlePage(page);
    });
  });
}

async function expectIceCubeHandlePage(page: Page): Promise<void> {
  await expect(page).toHaveURL(ICE_CUBE_ALIAS);
  // Claimed or not in the shared database, the alias page names 🧊🧊🧊 as its
  // canonical emoji path, which is what "that Handle's page" means.
  const canonical = await page
    .locator('link[rel="canonical"]')
    .getAttribute("href");
  expect(decodeURIComponent(canonical ?? "")).toMatch(
    /\/\u{1F9CA}\u{1F9CA}\u{1F9CA}$/u,
  );
}

test("the lookup's answers over HTTP: a redirect to the alias, or a page, never an error", async ({
  request,
}) => {
  const found = await request.get(
    `/find?q=${encodeURIComponent("Ice Cube, ice cube, ICE CUBE")}`,
    { maxRedirects: 0 },
  );
  expect(found.status()).toBe(307);
  expect(found.headers().location).toBe(ICE_CUBE_ALIAS);

  const spoken = await request.get(
    `/find?q=${encodeURIComponent(SPOKEN_WORDS)}`,
    { maxRedirects: 0 },
  );
  expect(spoken.status()).toBe(307);
  expect(spoken.headers().location).toBe(ICE_CUBE_ALIAS);

  for (const words of [NOT_FOUND_WORDS, "%", "curry rice wine pizza"]) {
    const answer = await request.get(`/find?q=${encodeURIComponent(words)}`, {
      maxRedirects: 0,
    });
    expect(answer.status(), `the answer for "${words}"`).toBe(200);
    expect(await answer.text()).toContain(findCopy.notFoundHeading);
  }

  const bare = await request.get("/find", { maxRedirects: 0 });
  expect(bare.status()).toBe(307);
  expect(bare.headers().location).toBe("/");
});
