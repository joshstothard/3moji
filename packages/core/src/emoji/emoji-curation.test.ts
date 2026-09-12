import {
  CURATED_CATEGORIES,
  EMOJI_CURATION,
  type EmojiArticle,
} from "./emoji-curation";
import { curatedEmojiSet, findCuratedEmoji, searchEmoji } from "./emoji-name";
import { releasedEmojiSet } from "./emoji-set";
import { RELEASED_CATEGORIES } from "./emoji-category";

const RELEASED_TOTAL = 307;

describe("the curated layer", () => {
  it("covers every released emoji and nothing else", () => {
    // ADR-0007 decision 5 makes a drop "an edit to the released-category list
    // plus a curation pass". This is the assertion that the second half
    // happened: a released emoji with no row, or a row for an emoji that is not
    // released, is a gap in the pass rather than a silent default.
    const released = releasedEmojiSet.map((entry) => entry.emoji).sort();
    const curated = Object.keys(EMOJI_CURATION).sort();

    expect(curated).toEqual(released);
    expect(curated).toHaveLength(RELEASED_TOTAL);
    expect(curatedEmojiSet).toHaveLength(RELEASED_TOTAL);
  });

  it("is curated for exactly the released categories", () => {
    expect([...CURATED_CATEGORIES].sort()).toEqual(
      [...RELEASED_CATEGORIES].sort(),
    );
  });

  it("keys every row to the emoji whose CLDR name it repeats", () => {
    // The set holds near-identical glyph pairs — 🐵/🐒, 🐶/🐕, 🐱/🐈, 🐭/🐁/🐀 —
    // so a row attached to the wrong key would satisfy every other assertion
    // here while making the product say the wrong name. Each row repeats the
    // CLDR name it believes it is curating; this is what checks that belief.
    const misKeyed = Object.entries(EMOJI_CURATION)
      .map(([emoji, curation]) => ({
        emoji,
        claimed: curation.spokenName,
        actual: releasedEmojiSet.find((entry) => entry.emoji === emoji)
          ?.spokenName,
      }))
      .filter((row) => row.claimed !== row.actual);

    expect(misKeyed).toEqual([]);
  });

  it("gives every released entry a non-empty display name and plural", () => {
    const incomplete = curatedEmojiSet.filter(
      (entry) => entry.displayName.trim() === "" || entry.plural.trim() === "",
    );

    expect(incomplete).toEqual([]);
    expect(curatedEmojiSet).toHaveLength(RELEASED_TOTAL);
  });

  it("gives every released entry a synonyms list, empty or otherwise", () => {
    const missing = curatedEmojiSet.filter(
      (entry) => !Array.isArray(entry.synonyms),
    );

    expect(missing).toEqual([]);
  });

  it("makes display names unique across the released set", () => {
    // The point is that two emoji cannot be *said* identically, so this compares
    // names as spoken — lowercased and whitespace-normalised — not as bytes.
    const spoken = curatedEmojiSet.map((entry) =>
      entry.displayName.toLowerCase().replace(/\s+/g, " ").trim(),
    );
    const duplicates = spoken.filter(
      (name, index) => spoken.indexOf(name) !== index,
    );

    expect(duplicates).toEqual([]);
    expect(new Set(spoken).size).toBe(RELEASED_TOTAL);
  });

  it("keeps the plural distinct from the display name unless English does not", () => {
    // Not every plural differs: "fish", "chopsticks" and "skis" are their own
    // plurals, and so are the Japanese loanwords. But a row that copied the
    // display name into the plural field by accident is a real risk across 307
    // hand-authored rows, and that mistake is invisible to every other
    // assertion here — so the ones that legitimately match are named rather
    // than waved through.
    const sameAsSingular = curatedEmojiSet
      .filter((entry) => entry.plural === entry.displayName)
      .map((entry) => entry.displayName);

    expect([...sameAsSingular].sort()).toEqual([
      "Japanese dolls",
      "blowfish",
      "cherries",
      "chopsticks",
      "clinking beer mugs",
      "clinking glasses",
      "dango",
      "deer",
      "fireworks",
      "fish",
      "flower playing cards",
      "french fries",
      "grapes",
      "oden",
      "pancakes",
      "paw prints",
      "peanuts",
      "shaved ice",
      "skis",
      "sparkles",
      "squid",
      "sushi",
      "theatre masks",
      "tropical fish",
    ]);
  });

  it("leaves the CLDR spoken name untouched on every curated entry", () => {
    // ADR-0005 decision 2: the CLDR short name is immutable, which is what keeps
    // the set reconcilable with Unicode. `emoji-set.test.ts` asserts the whole
    // candidate list against Unicode's own report; this asserts the curated
    // layer did not shadow or rewrite it on the way through.
    const rewritten = curatedEmojiSet.filter((entry) => {
      const canonical = releasedEmojiSet.find(
        (released) => released.emoji === entry.emoji,
      );
      return entry.spokenName !== canonical?.spokenName;
    });

    expect(rewritten).toEqual([]);
  });

  it("defaults the display name to the CLDR name for most of the set", () => {
    // ADR-0005 decision 3: "Override only where the canonical name reads badly
    // aloud, so this is a review pass rather than authoring a thousand names."
    // A creeping override count means the review pass turned into an authoring
    // pass, so it is pinned rather than merely asserted to be "low".
    const overridden = curatedEmojiSet.filter(
      (entry) => entry.displayName !== entry.spokenName,
    );

    expect(overridden).toHaveLength(29);
    expect(overridden.length / RELEASED_TOTAL).toBeLessThan(0.15);
  });

  it("leaves no colon in any display name", () => {
    // One of the three shapes the curation pass exists to fix. Zero in the
    // released set is the answer for this drop, not a reason to drop the check:
    // Objects and Smileys both contain colons and are curated in a later pass.
    const withColon = curatedEmojiSet
      .filter((entry) => entry.displayName.includes(":"))
      .map((entry) => entry.displayName);

    expect(withColon).toEqual([]);
  });
});

describe("the curated article", () => {
  function articleOf(codepoint: string): EmojiArticle | undefined {
    return findCuratedEmoji(codepoint)?.article;
  }

  it("is 'an' before a vowel and 'a' before a consonant", () => {
    expect(articleOf("🧊")).toBe("an"); // ice cube
    expect(articleOf("🥑")).toBe("an"); // avocado
    expect(articleOf("🐘")).toBe("an"); // elephant
    expect(articleOf("🌮")).toBe("a"); // taco
    expect(articleOf("🍕")).toBe("a"); // pizza
  });

  it("follows pronunciation, not spelling, where the two disagree", () => {
    // Both start with a vowel letter and a consonant sound. A vowel-letter rule
    // alone says "an unicorn" and "an ewe".
    expect(articleOf("🦄")).toBe("a"); // a unicorn
    expect(articleOf("🐑")).toBe("a"); // a ewe
  });

  it("is 'none' for a plural or mass noun that takes no article", () => {
    expect(articleOf("🥢")).toBe("none"); // chopsticks
    expect(articleOf("🍇")).toBe("none"); // grapes
    expect(articleOf("✨")).toBe("none"); // sparkles
  });
});

describe("searchEmoji", () => {
  function codepointsFor(query: string): readonly string[] {
    return searchEmoji(query).map((entry) => entry.emoji);
  }

  it("finds 🧊 by 'ice cube', the case this curation pass exists for", () => {
    // The founding example: the CLDR name is "ice", so before curation the
    // product's own pitch — "three ice cubes" — matched nothing.
    expect(codepointsFor("ice cube")).toContain("🧊");
    expect(findCuratedEmoji("🧊")).toMatchObject({
      spokenName: "ice",
      displayName: "ice cube",
      plural: "ice cubes",
    });
  });

  it("finds an emoji by a synonym alone", () => {
    // "aubergine" appears nowhere in 🍆's CLDR name or display name, so this can
    // only match through the synonyms list — which is what proves that path is
    // wired rather than incidentally covered by a display-name match.
    expect(codepointsFor("aubergine")).toEqual(["🍆"]);
    expect(findCuratedEmoji("🍆")?.displayName).toBe("eggplant");
  });

  it("still finds an emoji by its CLDR name after an override", () => {
    expect(codepointsFor("ice")).toContain("🧊");
  });

  it("matches case-insensitively and ignores surrounding whitespace", () => {
    expect(codepointsFor("  ICE Cube ")).toContain("🧊");
  });

  it("never returns an unreleased emoji", () => {
    // "grinning face" is Smileys & Emotion, which ADR-0007 decision 4 does not
    // schedule. It is in the candidate list and must stay unfindable here.
    expect(searchEmoji("grinning")).toEqual([]);
    expect(searchEmoji("face")).not.toEqual([]);
  });

  it("matches nothing for a blank query", () => {
    expect(searchEmoji("")).toEqual([]);
    expect(searchEmoji("   ")).toEqual([]);
  });

  it("matches nothing for a query no emoji carries", () => {
    expect(searchEmoji("zzzz")).toEqual([]);
  });
});

describe("findCuratedEmoji", () => {
  it("returns the curated names alongside the immutable CLDR name", () => {
    expect(findCuratedEmoji("🍎")).toEqual({
      codepoint: "U+1F34E",
      emoji: "🍎",
      spokenName: "red apple",
      category: "Food & Drink",
      released: true,
      displayName: "red apple",
      plural: "red apples",
      synonyms: ["apple", "fruit"],
      article: "a",
    });
  });

  it("returns undefined for an emoji no drop has released", () => {
    expect(findCuratedEmoji("😀")).toBeUndefined();
  });

  it("returns undefined for anything outside the candidate list", () => {
    expect(findCuratedEmoji("🇬🇧")).toBeUndefined();
    expect(findCuratedEmoji("a")).toBeUndefined();
    expect(findCuratedEmoji("")).toBeUndefined();
  });
});
