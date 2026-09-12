import { readFileSync } from "node:fs";
import path from "node:path";

import { z } from "zod";

import { EMOJI_SET_VERSION } from "./emoji-candidate";
import {
  EMOJI_CATEGORIES,
  RELEASED_CATEGORIES,
  type EmojiCategory,
} from "./emoji-category";
import {
  candidateEmojiSet,
  findEmojiByCodepoint,
  isClaimableEmoji,
  releasedEmojiSet,
} from "./emoji-set";

/**
 * ADR-0007 decision 2: the launch drop, with the counts the ADR commits to.
 * These numbers are load-bearing — 307 released emoji is what gives the
 * 28,934,443 three-emoji Handles the decision was taken on.
 */
const LAUNCH_DROP: readonly (readonly [EmojiCategory, number])[] = [
  ["Food & Drink", 113],
  ["Animals & Nature", 126],
  ["Activities", 68],
];
const RELEASED_TOTAL = 307;
const CANDIDATE_TOTAL = 1053;

const candidateFileSchema = z.array(
  z.object({
    codepoint: z.string(),
    emoji: z.string(),
    spokenName: z.string(),
    group: z.enum(EMOJI_CATEGORIES),
  }),
);

function readCandidateReport(): z.infer<typeof candidateFileSchema> {
  const candidatePath = path.resolve(
    __dirname,
    "../../../../docs/reports/2026-09-11-emoji-set.candidates.json",
  );
  const parsed: unknown = JSON.parse(readFileSync(candidatePath, "utf8"));
  return candidateFileSchema.parse(parsed);
}

/**
 * Whether `value` is exactly one code point. Written without spreading the
 * string: `no-misused-spread` rightly flags that, because splitting emoji is
 * usually a bug — here the whole point is to reject anything that splits.
 */
function isSingleCodePoint(value: string): boolean {
  const first = value.codePointAt(0);
  return first !== undefined && String.fromCodePoint(first) === value;
}

function countByCategory(
  entries: readonly { readonly category: EmojiCategory }[],
): Map<EmojiCategory, number> {
  const counts = new Map<EmojiCategory, number>();
  for (const entry of entries) {
    counts.set(entry.category, (counts.get(entry.category) ?? 0) + 1);
  }
  return counts;
}

describe("the candidate Emoji Set", () => {
  it("is pinned to Emoji 12.0 and derived from the candidate report", () => {
    // Proves the shipped data is generated, not retyped: it must equal the
    // report entry for entry, in order. If this fails, run
    // `npm run generate:emoji` rather than editing the generated module.
    const expected = readCandidateReport().map((candidate) => ({
      codepoint: candidate.codepoint,
      emoji: candidate.emoji,
      spokenName: candidate.spokenName,
      category: candidate.group,
      released: RELEASED_CATEGORIES.includes(candidate.group),
    }));

    expect(EMOJI_SET_VERSION).toBe("12.0");
    expect(candidateEmojiSet).toHaveLength(CANDIDATE_TOTAL);
    expect(candidateEmojiSet).toEqual(expected);
  });

  it("holds one code point per entry, so no sequence can slip in", () => {
    // A ZWJ sequence, a flag, a keycap or a skin-tone modifier all decompose
    // into more than one code point, and a variation selector adds one.
    const sequences = candidateEmojiSet.filter(
      (entry) => !isSingleCodePoint(entry.emoji),
    );

    expect(sequences).toEqual([]);
  });

  it("gives every entry a unique Spoken Name", () => {
    const names = candidateEmojiSet.map((entry) => entry.spokenName);
    const duplicates = names.filter(
      (name, index) => names.indexOf(name) !== index,
    );

    expect(duplicates).toEqual([]);
    expect(new Set(names).size).toBe(CANDIDATE_TOTAL);
  });
});

describe("the released Emoji Set", () => {
  it("contains exactly the 307 emoji of the three launch categories", () => {
    expect(releasedEmojiSet).toHaveLength(RELEASED_TOTAL);

    const counts = countByCategory(releasedEmojiSet);
    expect([...counts.entries()].sort()).toEqual([...LAUNCH_DROP].sort());
    expect(LAUNCH_DROP.reduce((total, [, count]) => total + count, 0)).toBe(
      RELEASED_TOTAL,
    );
  });

  it("gives every released emoji a unique Spoken Name", () => {
    const names = releasedEmojiSet.map((entry) => entry.spokenName);
    const duplicates = names.filter(
      (name, index) => names.indexOf(name) !== index,
    );

    expect(duplicates).toEqual([]);
    expect(new Set(names).size).toBe(RELEASED_TOTAL);
  });

  it("marks every released entry claimable", () => {
    const notClaimable = releasedEmojiSet.filter(
      (entry) => !isClaimableEmoji(entry.emoji),
    );

    expect(notClaimable).toEqual([]);
  });
});

describe("the unreleased categories", () => {
  // Spelled out rather than derived from RELEASED_CATEGORIES: a test
  // parameterised on the thing it constrains stops constraining it. ADR-0007
  // decisions 3 and 4 — Objects deferred pending curation, the rest unscheduled.
  const UNRELEASED_AT_LAUNCH: readonly EmojiCategory[] = [
    "Objects",
    "People & Body",
    "Smileys & Emotion",
    "Symbols",
    "Travel & Places",
  ];

  it("are every category outside the launch drop", () => {
    const complement = EMOJI_CATEGORIES.filter(
      (category) => !RELEASED_CATEGORIES.includes(category),
    );

    expect([...complement].sort()).toEqual([...UNRELEASED_AT_LAUNCH].sort());
  });

  it.each(UNRELEASED_AT_LAUNCH)(
    "keeps %s in the data but marked unreleased",
    (category) => {
      const entries = candidateEmojiSet.filter(
        (entry) => entry.category === category,
      );

      expect(entries.length).toBeGreaterThan(0);
      expect(entries.every((entry) => !entry.released)).toBe(true);
    },
  );

  it.each(UNRELEASED_AT_LAUNCH)("makes no %s emoji claimable", (category) => {
    const claimable = candidateEmojiSet
      .filter((entry) => entry.category === category)
      .filter((entry) => isClaimableEmoji(entry.emoji));

    expect(claimable).toEqual([]);
  });
});

describe("findEmojiByCodepoint", () => {
  it("finds a released emoji by its code point", () => {
    expect(findEmojiByCodepoint("🍎")).toEqual({
      codepoint: "U+1F34E",
      emoji: "🍎",
      spokenName: "red apple",
      category: "Food & Drink",
      released: true,
    });
  });

  it("finds an unreleased emoji, so a caller can tell unknown from unreleased", () => {
    expect(findEmojiByCodepoint("😀")).toMatchObject({
      spokenName: "grinning face",
      category: "Smileys & Emotion",
      released: false,
    });
    expect(isClaimableEmoji("😀")).toBe(false);
  });

  it("returns undefined for anything outside the candidate list", () => {
    // Excluded by construction: a flag (regional indicator pair), a ZWJ
    // sequence, a keycap, and a plain character.
    expect(findEmojiByCodepoint("🇬🇧")).toBeUndefined();
    expect(findEmojiByCodepoint("👩‍💻")).toBeUndefined();
    expect(findEmojiByCodepoint("1️⃣")).toBeUndefined();
    expect(findEmojiByCodepoint("a")).toBeUndefined();
    expect(findEmojiByCodepoint("")).toBeUndefined();
    expect(isClaimableEmoji("🇬🇧")).toBe(false);
  });
});
