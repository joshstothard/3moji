import { toHandleKey, type HandleKey } from "../db/handle-key";
import { curatedEmojiSet, findCuratedEmoji } from "../emoji/emoji-name";
import type { HandleSearchIndex } from "../ports/handle-search-index";
import type { ReservedHandleList } from "./reserved-handles";
import {
  SEARCH_EMOJI_LIMIT,
  SEARCH_HANDLE_LIMIT,
  searchHandles,
  searchTermsOf,
  suggestEmoji,
} from "./search-handles";

/**
 * The header search's rules
 * ([ADR-0012](../../../../docs/adr/0012-header-search-lists-claimed-handles-with-display-names-capped-and-rate-limited.md),
 * [#254](https://github.com/joshstothard/3moji/issues/254)), written from the
 * ADR's decisions rather than from the implementation:
 *
 * - decision 3, matching: one to three complete term slugs or emoji, each
 *   occurring in the Handle in any position; emoji suggestions prefix-match
 *   curated names from two characters; display names are not searchable.
 * - decision 4, caps: 5 Handles and 8 emoji.
 * - decision 5, ordering: exact match, then more of the query's emoji, then
 *   resolver order.
 * - decision 2, results: claimed Handles only, never Reserved, each with its
 *   emoji, canonical alias and display name.
 */

const RED = "\u{1F34E}";
const GREEN = "\u{1F34F}";
const PIZZA = "\u{1F355}";
const ICE = "\u{1F9CA}";
const PIE = "\u{1F967}";

/** No Reserved Handles at all, so ordering tests are about ordering alone. */
const NOTHING_RESERVED: ReservedHandleList = { blocked: [], entries: [] };

function keyOf(emoji: string): HandleKey {
  const key = toHandleKey(emoji);
  if (key === undefined) throw new Error(`not a Handle: ${emoji}`);
  return key;
}

/**
 * A {@link HandleSearchIndex} over a list of claimed keys, honouring the port
 * exactly: every group must have one of its emoji somewhere in the key. It
 * records what it was asked, so a test can prove what never reached it.
 */
function claimedIndex(claimed: readonly string[]): {
  readonly index: HandleSearchIndex;
  readonly asked: (readonly (readonly string[])[])[];
} {
  const asked: (readonly (readonly string[])[])[] = [];
  return {
    asked,
    index: {
      claimedKeysContaining: (groups, limit) => {
        asked.push(groups);
        return Promise.resolve(
          claimed
            .filter((key) =>
              groups.every((group) =>
                group.some((emoji) => Array.from(key).includes(emoji)),
              ),
            )
            .slice(0, limit)
            .map(keyOf),
        );
      },
    },
  };
}

function profilesNaming(names: Readonly<Record<string, string>> = {}): {
  readonly profiles: {
    displayNamesOf: (
      keys: readonly HandleKey[],
    ) => Promise<ReadonlyMap<HandleKey, string>>;
  };
  readonly asked: (readonly HandleKey[])[];
} {
  const asked: (readonly HandleKey[])[] = [];
  return {
    asked,
    profiles: {
      displayNamesOf: (keys) => {
        asked.push(keys);
        const found = new Map<HandleKey, string>();
        for (const key of keys) {
          const name = names[key];
          if (name !== undefined) found.set(key, name);
        }
        return Promise.resolve(found);
      },
    },
  };
}

const keysOf = (search: { readonly handles: readonly { key: string }[] }) =>
  search.handles.map((handle) => handle.key);

const emojiOf = (
  terms: readonly (readonly { emoji: string }[])[] | undefined,
) => terms?.map((term) => term.map((entry) => entry.emoji));

describe("searchTermsOf: what a query can search for", () => {
  it("reads a complete term slug as every emoji it names", () => {
    expect(emojiOf(searchTermsOf("apple"))).toEqual([[RED, GREEN]]);
    expect(emojiOf(searchTermsOf("ice-cube"))).toEqual([[ICE]]);
  });

  it("reads typed emoji as one term each, presentation selectors and all", () => {
    expect(emojiOf(searchTermsOf(`${RED}\u{FE0F}${PIZZA}`))).toEqual([
      [RED],
      [PIZZA],
    ]);
  });

  it("mixes words and emoji, separated by spaces, commas or the alias dot", () => {
    expect(emojiOf(searchTermsOf(`Apple, ${PIZZA} ice-cube`))).toEqual([
      [RED, GREEN],
      [PIZZA],
      [ICE],
    ]);
    expect(emojiOf(searchTermsOf("red-apple.pizza.ice-cube"))).toEqual([
      [RED],
      [PIZZA],
      [ICE],
    ]);
  });

  it("searches nothing for a word that is not a complete term", () => {
    expect(searchTermsOf("appl")).toBeUndefined();
    expect(searchTermsOf("apple wibble")).toBeUndefined();
  });

  it("searches nothing for more than three terms, or none", () => {
    expect(searchTermsOf("apple apple apple apple")).toBeUndefined();
    expect(searchTermsOf(`${RED}${RED}${RED}${RED}`)).toBeUndefined();
    expect(searchTermsOf("   ")).toBeUndefined();
  });

  it("searches nothing for an emoji nobody can claim, or an overlong query", () => {
    expect(searchTermsOf("\u{1F600}")).toBeUndefined();
    expect(searchTermsOf(`apple${" ".repeat(300)}`)).toBeUndefined();
  });
});

describe("searchHandles: matching (decision 3)", () => {
  it("finds a claimed Handle holding the term's emoji in any position", async () => {
    const { index } = claimedIndex([
      `${ICE}${ICE}${PIZZA}`,
      `${ICE}${RED}${ICE}`,
    ]);

    const search = await searchHandles({
      query: "pizza",
      index,
      profiles: profilesNaming().profiles,
      list: NOTHING_RESERVED,
    });

    expect(keysOf(search)).toEqual([`${ICE}${ICE}${PIZZA}`]);
  });

  it("needs every term, each in a position of its own", async () => {
    const { index } = claimedIndex([
      `${PIZZA}${ICE}${ICE}`,
      `${PIZZA}${ICE}${PIZZA}`,
      `${ICE}${PIZZA}${RED}`,
    ]);

    const search = await searchHandles({
      query: "pizza pizza",
      index,
      profiles: profilesNaming().profiles,
      list: NOTHING_RESERVED,
    });

    expect(keysOf(search)).toEqual([`${PIZZA}${ICE}${PIZZA}`]);
  });

  it("asks the index about each term's emoji, and never reads for a query that is not terms", async () => {
    const { index, asked } = claimedIndex([`${ICE}${ICE}${PIZZA}`]);
    const profiles = profilesNaming();

    await searchHandles({
      query: `apple ${PIZZA}`,
      index,
      profiles: profiles.profiles,
    });
    const unread = await searchHandles({
      query: "appl",
      index,
      profiles: profiles.profiles,
    });

    expect(asked).toEqual([[[RED, GREEN], [PIZZA]]]);
    expect(unread.handles).toEqual([]);
  });

  it("does not search display names: a name equal to the query finds nothing", async () => {
    const named = `${ICE}${ICE}${ICE}`;
    const { index, asked } = claimedIndex([named]);
    const profiles = profilesNaming({ [named]: "pizza" });

    const byTerm = await searchHandles({
      query: "pizza",
      index,
      profiles: profiles.profiles,
      list: NOTHING_RESERVED,
    });
    const byName = await searchHandles({
      query: "Ada Lovelace",
      index,
      profiles: profiles.profiles,
      list: NOTHING_RESERVED,
    });

    expect(byTerm.handles).toEqual([]);
    expect(byName.handles).toEqual([]);
    // Neither query reached a display name: the one read asked for pizza's
    // emoji, and no Profile was read to decide anything.
    expect(asked).toEqual([[[PIZZA]]]);
    expect(profiles.asked.flat()).toEqual([]);
  });

  it("never lists a Reserved Handle, even one claimed before it was reserved", async () => {
    const reservedLater = `${ICE}${PIZZA}${ICE}`;
    const { index } = claimedIndex([reservedLater, `${ICE}${ICE}${PIZZA}`]);

    const search = await searchHandles({
      query: "pizza",
      index,
      profiles: profilesNaming().profiles,
      list: {
        blocked: [],
        entries: [{ key: reservedLater, scope: "platform", why: "a test" }],
      },
    });

    expect(keysOf(search)).toEqual([`${ICE}${ICE}${PIZZA}`]);
  });

  it("uses the shipped Reserved list by default", async () => {
    // 🍎🍎🍎 is on the shipped list (a brand-like triple).
    const { index } = claimedIndex([
      `${RED}${RED}${RED}`,
      `${RED}${ICE}${RED}`,
    ]);

    const search = await searchHandles({
      query: "red-apple",
      index,
      profiles: profilesNaming().profiles,
    });

    expect(keysOf(search)).toEqual([`${RED}${ICE}${RED}`]);
  });
});

describe("searchHandles: what a result carries (decision 2)", () => {
  it("carries the emoji, its path, the canonical alias and the display name, or null", async () => {
    const named = `${RED}${ICE}${PIZZA}`;
    const unnamed = `${PIZZA}${ICE}${RED}`;
    const { index } = claimedIndex([named, unnamed]);
    const profiles = profilesNaming({ [named]: "Ada" });

    const search = await searchHandles({
      query: "ice-cube",
      index,
      profiles: profiles.profiles,
      list: NOTHING_RESERVED,
    });

    expect(search.handles).toEqual([
      {
        key: named,
        encoded: encodeURIComponent(named),
        alias: "red-apple.ice-cube.pizza",
        displayName: "Ada",
      },
      {
        key: unnamed,
        encoded: encodeURIComponent(unnamed),
        alias: "pizza.ice-cube.red-apple",
        displayName: null,
      },
    ]);
    // One read of names, for the Handles shown and no others.
    expect(profiles.asked).toEqual([[named, unnamed]]);
  });
});

describe("searchHandles: caps (decision 4)", () => {
  it("returns at most five Handles, and reads names for those five only", async () => {
    const claimed = [PIZZA, ICE, RED, GREEN, PIE].flatMap((second) =>
      [PIZZA, ICE].map((third) => `${ICE}${second}${third}`),
    );
    expect(claimed.length).toBeGreaterThan(SEARCH_HANDLE_LIMIT);
    const { index } = claimedIndex(claimed);
    const profiles = profilesNaming();

    const search = await searchHandles({
      query: "ice-cube",
      index,
      profiles: profiles.profiles,
      list: NOTHING_RESERVED,
    });

    expect(search.handles).toHaveLength(5);
    expect(profiles.asked).toEqual([search.handles.map((found) => found.key)]);
  });

  it("returns at most eight emoji suggestions", async () => {
    const prefixed = curatedEmojiSet.filter((entry) =>
      /(^|[\s-])ca/.test(entry.displayName.toLowerCase()),
    );
    expect(prefixed.length).toBeGreaterThan(SEARCH_EMOJI_LIMIT);

    const search = await searchHandles({
      query: "ca",
      index: claimedIndex([]).index,
      profiles: profilesNaming().profiles,
    });

    expect(search.emoji).toHaveLength(8);
  });
});

describe("searchHandles: ordering (decision 5)", () => {
  it("orders more of the query's emoji first, then resolver order", async () => {
    // Given scrambled, so the order cannot be the index's.
    const { index } = claimedIndex([
      `${PIZZA}${RED}${PIZZA}`,
      `${GREEN}${RED}${GREEN}`,
      `${RED}${PIE}${RED}`,
      `${RED}${RED}${RED}`,
    ]);
    // Resolver order is candidate-list order: the red apple comes before the
    // green one.
    const positionOf = (emoji: string): number =>
      curatedEmojiSet.findIndex((entry) => entry.emoji === emoji);
    expect(findCuratedEmoji(RED)).toBeDefined();
    expect(positionOf(RED)).toBeGreaterThanOrEqual(0);
    expect(positionOf(RED)).toBeLessThan(positionOf(GREEN));

    const search = await searchHandles({
      query: "apple",
      index,
      profiles: profilesNaming().profiles,
      list: NOTHING_RESERVED,
    });

    expect(keysOf(search)).toEqual([
      `${RED}${RED}${RED}`,
      `${GREEN}${RED}${GREEN}`,
      `${RED}${PIE}${RED}`,
      `${PIZZA}${RED}${PIZZA}`,
    ]);
  });

  it("puts the Handle matching the whole query exactly first, ahead of resolver order", async () => {
    const exact = `${PIZZA}${GREEN}${RED}`;
    const { index } = claimedIndex([
      `${RED}${RED}${PIZZA}`,
      `${RED}${PIZZA}${GREEN}`,
      exact,
    ]);

    const search = await searchHandles({
      query: "pizza apple apple",
      index,
      profiles: profilesNaming().profiles,
      list: NOTHING_RESERVED,
    });

    expect(keysOf(search)[0]).toBe(exact);
    expect(keysOf(search)).toHaveLength(3);
  });
});

describe("suggestEmoji: emoji suggestions (decision 3)", () => {
  const names = (query: string) =>
    suggestEmoji(query).map((found) => found.emoji);

  it("prefix-matches curated names, at the start of any word", () => {
    expect(names("apple")).toEqual(expect.arrayContaining([RED, GREEN]));
    expect(names("gre")).toContain(GREEN);
    expect(suggestEmoji("pizza")).toEqual([{ emoji: PIZZA, name: "pizza" }]);
  });

  it("does not match the middle of a word", () => {
    expect(names("pple")).not.toContain(RED);
    expect(names("izza")).not.toContain(PIZZA);
  });

  it("suggests nothing below two characters", () => {
    expect(suggestEmoji("p")).toEqual([]);
    expect(suggestEmoji(" a ")).toEqual([]);
  });

  it("is what searchHandles answers as its emoji, whether or not any Handle matched", async () => {
    const search = await searchHandles({
      query: "piz",
      index: claimedIndex([`${PIZZA}${ICE}${ICE}`]).index,
      profiles: profilesNaming().profiles,
    });

    expect(search).toEqual({ handles: [], emoji: suggestEmoji("piz") });
    expect(search.emoji.map((found) => found.emoji)).toContain(PIZZA);
  });
});
