import { curatedEmojiSet } from "../emoji/emoji-name";

import {
  ALIAS_SEPARATOR,
  aliasTermSlugs,
  canonicalAliasOf,
  emojiNamedBy as curatedNamedBy,
  resolveAlias,
} from "./alias";

/**
 * The word alias
 * ([ADR-0008](../../../../docs/adr/0008-handles-are-addressable-by-emoji-and-by-their-word-alias.md)).
 *
 * The assertions below are written from the ADR's decisions rather than from
 * the implementation: three dot-separated term slugs (decision 2), every
 * position accepting any of that emoji's terms with the `displayName` slugs as
 * the one canonical alias (decision 3), and a **candidate set** rather than a
 * guess (decision 4).
 */

const ICE = "\u{1F9CA}";
const RED_APPLE = "\u{1F34E}";
const GREEN_APPLE = "\u{1F34F}";
const AUBERGINE = "\u{1F346}";
const PIZZA = "\u{1F355}";
const BAT = "\u{1F987}";

/**
 * The test's own slugger, deliberately a second implementation of the rule
 * rather than an import of the one under test: an expectation derived from the
 * code it constrains constrains nothing.
 */
function slug(term: string): string {
  return term
    .normalize("NFC")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Every emoji whose curated terms include this slug, in candidate order. */
function emojiNamedBy(term: string): readonly string[] {
  return curatedEmojiSet
    .filter((entry) =>
      [entry.displayName, entry.spokenName, entry.plural, ...entry.synonyms]
        .map(slug)
        .includes(term),
    )
    .map((entry) => entry.emoji);
}

function keysOf(alias: string): readonly string[] {
  const result = resolveAlias(alias);
  if (!result.ok) {
    throw new Error(`expected ${alias} to resolve, got ${result.reason}`);
  }
  return result.candidates.map((candidate) => candidate.key);
}

describe("emojiNamedBy", () => {
  const named = (word: string) =>
    curatedNamedBy(word)?.map((entry) => entry.emoji);

  it("answers every emoji one complete term names", () => {
    expect(named("apple")).toEqual(
      expect.arrayContaining([RED_APPLE, GREEN_APPLE]),
    );
  });

  it("slugs the word first, so case and spacing do not matter", () => {
    expect(named("Ice Cube")).toEqual([ICE]);
  });

  it("answers nothing for part of a term, or for nothing", () => {
    expect(named("appl")).toBeUndefined();
    expect(named("")).toBeUndefined();
    expect(named("!!!")).toBeUndefined();
  });
});

describe("canonicalAliasOf", () => {
  it("joins the display-name slugs with dots", () => {
    expect(canonicalAliasOf([ICE, ICE, ICE])).toBe(
      "ice-cube.ice-cube.ice-cube",
    );
  });

  it("uses the curated display name, not the CLDR name", () => {
    // 🍆 is CLDR "eggplant" and curated "aubergine" (ADR-0007).
    expect(canonicalAliasOf([AUBERGINE, PIZZA, ICE])).toBe(
      "aubergine.pizza.ice-cube",
    );
  });

  it("has no alias for something that is not a claimable emoji", () => {
    expect(canonicalAliasOf(["a", "b", "c"])).toBeUndefined();
  });

  it("uses the curated alias name where the display name also names another emoji", () => {
    // ADR-0011 decision 1: `bat` names both 🦇 and 🏓, so `bat.bat.bat` names
    // eight Handles and a share link built from it would turn into a listing
    // the moment one of the other seven was claimed.
    expect(canonicalAliasOf([BAT, BAT, BAT])).toBe("bats.bats.bats");
  });

  it.each([
    ["🦇", "bats"],
    ["🐋", "whales"],
    ["🦗", "grasshopper"],
    ["🌼", "flower"],
    ["🍨", "sundae"],
  ])("gives %s the alias term %s", (emoji, term) => {
    expect(canonicalAliasOf([emoji, emoji, emoji])).toBe(
      [term, term, term].join(ALIAS_SEPARATOR),
    );
  });

  it("keeps the display-name slug wherever it names only that emoji", () => {
    // ADR-0011 decision 4: no shorter word is preferred anywhere else. `apple`
    // names 🍎 and 🍏, but `red-apple` names only 🍎, so it stays.
    expect(canonicalAliasOf([RED_APPLE, RED_APPLE, RED_APPLE])).toBe(
      "red-apple.red-apple.red-apple",
    );
    expect(canonicalAliasOf([BAT, PIZZA, ICE])).toBe("bats.pizza.ice-cube");
  });
});

/**
 * The curation rule that keeps every share link meaning one Handle
 * ([ADR-0011](../../../../docs/adr/0011-canonical-word-aliases-name-one-handle-and-unclaimed-aliases-list-claimable-handles.md)
 * decision 3).
 *
 * Checked against this file's own `slug` and `emojiNamedBy` rather than the
 * resolver's index, so the rule is asserted by a second implementation. A
 * category release that brings a new clash turns this red until it is curated.
 *
 * Homogeneous triples are enough for the first condition: a Handle's candidate
 * set is the product of what each position names, so a mixed triple names one
 * Handle exactly when each of its positions does, and every position is some
 * emoji's canonical term.
 */
describe("the canonical alias curation", () => {
  const withAliasName = curatedEmojiSet.filter(
    (entry) => entry.aliasName !== undefined,
  );

  it("names exactly one Handle for every released emoji", () => {
    const notOne = curatedEmojiSet.flatMap((entry) => {
      const alias = canonicalAliasOf([entry.emoji, entry.emoji, entry.emoji]);
      const count = alias === undefined ? 0 : keysOf(alias).length;
      return count === 1
        ? []
        : [`${entry.emoji} ${String(alias)} (${String(count)})`];
    });

    expect(notOne).toEqual([]);
  });

  it("never sets an alias name that names more than one emoji", () => {
    const shared = withAliasName.flatMap((entry) => {
      const named = emojiNamedBy(slug(entry.aliasName ?? ""));
      return named.length === 1 ? [] : [`${entry.emoji} ${named.join("")}`];
    });

    expect(shared).toEqual([]);
  });

  it("only sets an alias name that is one of the emoji's own terms", () => {
    const foreign = withAliasName.flatMap((entry) => {
      const own = [
        entry.displayName,
        entry.spokenName,
        entry.plural,
        ...entry.synonyms,
      ].map(slug);
      return own.includes(slug(entry.aliasName ?? ""))
        ? []
        : [`${entry.emoji} ${String(entry.aliasName)}`];
    });

    expect(foreign).toEqual([]);
  });

  it("never sets an alias name where the display name is already unique", () => {
    const needless = withAliasName.flatMap((entry) =>
      emojiNamedBy(slug(entry.displayName)).length === 1
        ? [`${entry.emoji} ${entry.displayName}`]
        : [],
    );

    expect(needless).toEqual([]);
  });
});

describe("resolveAlias", () => {
  it("resolves the canonical alias of 🧊🧊🧊 to exactly that Handle", () => {
    expect(keysOf("ice-cube.ice-cube.ice-cube")).toEqual([
      `${ICE}${ICE}${ICE}`,
    ]);
  });

  it("carries the encoded path and the curated entries of each candidate", () => {
    const result = resolveAlias("ice-cube.ice-cube.ice-cube");
    if (!result.ok) throw new Error("expected a resolution");
    const [candidate] = result.candidates;
    expect(candidate?.encoded).toBe(encodeURIComponent(`${ICE}${ICE}${ICE}`));
    expect(candidate?.emoji.map((entry) => entry.emoji)).toEqual([
      ICE,
      ICE,
      ICE,
    ]);
    expect(candidate?.emoji.map((entry) => entry.displayName)).toEqual([
      "ice cube",
      "ice cube",
      "ice cube",
    ]);
  });

  it("accepts the CLDR name in any position", () => {
    // "ice" is 🧊's CLDR spokenName; "ice cube" is the curated display name.
    expect(keysOf("ice.ice-cube.ice")).toEqual([`${ICE}${ICE}${ICE}`]);
  });

  it("accepts the plural in any position", () => {
    expect(keysOf("ice-cubes.ice-cubes.ice-cubes")).toEqual([
      `${ICE}${ICE}${ICE}`,
    ]);
  });

  it("accepts a synonym in any position", () => {
    // "eggplant" survives as a synonym of the aubergine.
    expect(keysOf("eggplant.eggplant.eggplant")).toEqual([
      `${AUBERGINE}${AUBERGINE}${AUBERGINE}`,
    ]);
  });

  it("is case-insensitive", () => {
    expect(keysOf("ICE-CUBE.Ice-Cube.ice-CUBE")).toEqual([
      `${ICE}${ICE}${ICE}`,
    ]);
  });

  it("decodes the segment once, as the emoji path does", () => {
    // %2E is a dot, and decoding before splitting is what makes it a
    // separator — the same decode-then-interpret order as `canonicalise`.
    expect(keysOf(`ice-cube%2Eice-cube%2Eice-cube`)).toEqual([
      `${ICE}${ICE}${ICE}`,
    ]);
  });

  it("answers apple.apple.apple with all eight Handles and no guess", () => {
    // `apple` is a synonym of both 🍎 and 🍏, so the alias names 2³ Handles.
    // The whole product is returned, in a deterministic order, because
    // choosing one of them would be inventing an answer (ADR-0008 decision 4).
    expect(keysOf("apple.apple.apple")).toEqual([
      `${RED_APPLE}${RED_APPLE}${RED_APPLE}`,
      `${RED_APPLE}${RED_APPLE}${GREEN_APPLE}`,
      `${RED_APPLE}${GREEN_APPLE}${RED_APPLE}`,
      `${RED_APPLE}${GREEN_APPLE}${GREEN_APPLE}`,
      `${GREEN_APPLE}${RED_APPLE}${RED_APPLE}`,
      `${GREEN_APPLE}${RED_APPLE}${GREEN_APPLE}`,
      `${GREEN_APPLE}${GREEN_APPLE}${RED_APPLE}`,
      `${GREEN_APPLE}${GREEN_APPLE}${GREEN_APPLE}`,
    ]);
  });

  it("returns the worst measured case in full", () => {
    // ADR-0008 measured `celebration` as the worst single term: four emoji,
    // so 64 candidate Handles.
    expect(emojiNamedBy("celebration")).toHaveLength(4);
    expect(keysOf("celebration.celebration.celebration")).toHaveLength(64);
  });

  it("never returns the same Handle twice", () => {
    const keys = keysOf("apple.apple.apple");
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("is deterministic", () => {
    expect(keysOf("apple.apple.apple")).toEqual(keysOf("apple.apple.apple"));
  });

  it.each([
    ["two terms", "ice-cube.ice-cube"],
    ["four terms", "ice-cube.ice-cube.ice-cube.ice-cube"],
    ["no separator at all", "ice-cube"],
    ["an empty term", "ice-cube..ice-cube"],
    ["nothing but separators", ".."],
    ["a malformed escape", "%F0%9F.ice-cube.ice-cube"],
    ["an emoji Handle", `${ICE}${ICE}${ICE}`],
    // The shape an autolinker could plausibly produce out of a mangled share:
    // emoji in the alias grammar's own separators. It reaches here rather than
    // `canonicalise` — the dots make it five code points, so the length gate
    // rejects it — and each position slugs away to nothing.
    [
      "emoji separated by dots",
      `${encodeURIComponent(ICE)}%2E${encodeURIComponent(ICE)}%2E${encodeURIComponent(ICE)}`,
    ],
  ])("rejects %s as not an alias", (_name, segment) => {
    expect(resolveAlias(segment)).toEqual({
      ok: false,
      reason: "not-an-alias",
    });
  });

  it("names the leftmost unknown term", () => {
    expect(resolveAlias("ice-cube.nonsense.rubbish")).toEqual({
      ok: false,
      reason: "unknown-term",
      term: "nonsense",
    });
  });
});

describe("the parse is unambiguous by construction", () => {
  /**
   * The property the dot separator exists for. ADR-0008 measured 1,152 of
   * 44,976 hyphen-joined candidates admitting more than one three-emoji
   * reading; a dot cannot occur inside a slug, so a three-term alias has
   * exactly one reading. That claim is only true while **no** term slug
   * contains the separator, which is what this asserts over every one of them.
   */
  it("has no separator inside any term slug", () => {
    const slugs = aliasTermSlugs();
    expect(slugs.length).toBeGreaterThan(0);
    expect(slugs.filter((term) => term.includes(ALIAS_SEPARATOR))).toEqual([]);
    expect(slugs.filter((term) => term === "")).toEqual([]);
  });

  it("indexes every curated term of every released emoji", () => {
    const expected = new Set(
      curatedEmojiSet.flatMap((entry) =>
        [
          entry.displayName,
          entry.spokenName,
          entry.plural,
          ...entry.synonyms,
        ].map(slug),
      ),
    );
    expect(new Set(aliasTermSlugs())).toEqual(expected);
  });

  it("splits every emoji's canonical alias into exactly three terms", () => {
    for (const entry of curatedEmojiSet) {
      const alias = canonicalAliasOf([entry.emoji, entry.emoji, entry.emoji]);
      expect(alias?.split(ALIAS_SEPARATOR)).toHaveLength(3);
    }
  });
});
