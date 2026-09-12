import { curatedEmojiSet, findCuratedEmoji } from "./emoji-name";
import { spokenHandle } from "./spoken-handle";

describe("spokenHandle", () => {
  it("collapses the founding case to 'three ice cubes'", () => {
    // The product's own pitch (`CONTEXT.md`). With the CLDR name alone this
    // would read "three ices", which is what ADR-0005 decision 3 exists to fix.
    expect(spokenHandle(["🧊", "🧊", "🧊"])).toBe("three ice cubes");
  });

  it("says 'an ice cube', never 'a ice cube'", () => {
    // The bug the throwaway picker prototype surfaced.
    expect(spokenHandle(["🧊", "🌮", "🍕"])).toBe(
      "an ice cube, a taco and a pizza",
    );
  });

  it("collapses a run of two and keeps the rest singular", () => {
    expect(spokenHandle(["🧊", "🧊", "🌮"])).toBe("two ice cubes and a taco");
  });

  it("collapses only consecutive runs, because a Handle is ordered", () => {
    // 🧊🍕🧊 and 🧊🧊🍕 are different Handles (`CONTEXT.md`, ADR-0004), so they
    // must not be said the same way. Collapsing every occurrence rather than
    // consecutive ones would make both read "two ice cubes and a pizza".
    expect(spokenHandle(["🧊", "🍕", "🧊"])).toBe(
      "an ice cube, a pizza and an ice cube",
    );
    expect(spokenHandle(["🧊", "🧊", "🍕"])).toBe("two ice cubes and a pizza");
  });

  it("uses the curated plural, not a suffix rule", () => {
    // English plurals are not mechanical, which is why ADR-0005 stores them. A
    // "+s" rule gives "cherrys", "peachs", "loafs" and "bunch of grapess".
    expect(spokenHandle(["🍒", "🍒", "🍒"])).toBe("three cherries");
    expect(spokenHandle(["🍑", "🍑", "🍑"])).toBe("three peaches");
    expect(spokenHandle(["🍞", "🍞", "🍞"])).toBe("three loaves of bread");
    expect(spokenHandle(["🦋", "🦋", "🦋"])).toBe("three butterflies");
  });

  it("says a name that takes no article bare", () => {
    // "a chopsticks" and "a grapes" are what a blanket article rule produces.
    expect(spokenHandle(["🥢", "🌮", "🍇"])).toBe(
      "chopsticks, a taco and grapes",
    );
    expect(spokenHandle(["✨", "✨", "✨"])).toBe("three sparkles");
  });

  it("follows pronunciation where it disagrees with spelling", () => {
    expect(spokenHandle(["🦄", "🐑", "🐘"])).toBe(
      "a unicorn, a ewe and an elephant",
    );
  });

  it("says a two-emoji sequence without a comma", () => {
    // Not claimable at launch — one- and two-emoji Handles are Reserved — but
    // the picker says a partial pick aloud as the person builds it.
    expect(spokenHandle(["🧊", "🌮"])).toBe("an ice cube and a taco");
    expect(spokenHandle(["🧊", "🧊"])).toBe("two ice cubes");
  });

  it("says a single emoji with its article", () => {
    expect(spokenHandle(["🧊"])).toBe("an ice cube");
    expect(spokenHandle(["🥢"])).toBe("chopsticks");
  });

  it("has no spoken form for an empty sequence", () => {
    expect(spokenHandle([])).toBeUndefined();
  });

  it("has no spoken form for a Handle that could not exist", () => {
    // An unreleased emoji, an emoji outside the candidate list, a flag, and a
    // plain character. A Handle containing any of them cannot be claimed, and
    // half a sentence would be worse than none.
    expect(spokenHandle(["😀", "🌮", "🍕"])).toBeUndefined();
    expect(spokenHandle(["🌮", "🇬🇧", "🍕"])).toBeUndefined();
    expect(spokenHandle(["🌮", "a", "🍕"])).toBeUndefined();
  });

  it("says every three-of-a-kind Handle in the released set grammatically", () => {
    // 307 all-same triples, which are freely claimable (ADR-0004) and the shape
    // the pitch is built on. "three" plus the plural, and nothing left dangling.
    const spoken = curatedEmojiSet.map((entry) => ({
      emoji: entry.emoji,
      said: spokenHandle([entry.emoji, entry.emoji, entry.emoji]),
    }));

    const wrong = spoken.filter(
      (row) =>
        row.said !== `three ${findCuratedEmoji(row.emoji)?.plural ?? ""}`,
    );

    expect(wrong).toEqual([]);
    expect(spoken).toHaveLength(307);
  });

  it("gives every released emoji a singular form with no dangling article", () => {
    // Catches the shape a blanket article rule produces: "a chopsticks".
    const said = curatedEmojiSet.map(
      (entry) => spokenHandle([entry.emoji]) ?? "",
    );

    expect(said.filter((phrase) => phrase === "")).toEqual([]);
    expect(said.filter((phrase) => /^an? (?!\w)/.test(phrase))).toEqual([]);
    expect(said.filter((phrase) => phrase.endsWith(" "))).toEqual([]);
  });
});
