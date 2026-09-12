import { candidateEmojiSet } from "../emoji/emoji-set";

import { canonicalise, HANDLE_LENGTH } from "./canonicalise";

/**
 * Released code points, one per launch category, used to build valid Handles.
 * Spelled out rather than drawn from `releasedEmojiSet`: a test parameterised
 * on the value it constrains constrains nothing.
 */
const ICE = "\u{1F9CA}"; // 🧊 ice, Food & Drink
const RED_APPLE = "\u{1F34E}"; // 🍎 red apple, Food & Drink
const CAT = "\u{1F408}"; // 🐈 cat, Animals & Nature
const SOCCER_BALL = "\u{26BD}"; // ⚽ soccer ball, Activities — one BMP code point

/** In the candidate list, but its category is not released (ADR-0007). */
const GRINNING_FACE = "\u{1F600}"; // 😀 Smileys & Emotion
const FLOPPY_DISK = "\u{1F4BE}"; // 💾 Objects, deferred pending curation

/** Not in the candidate list at all. */
const EYE = "\u{1F441}"; // 👁 People & Body, excluded from the set
const SPEECH_BUBBLE = "\u{1F5E8}"; // 🗨 Symbols, excluded from the set
const ZWJ = "\u{200D}";
const SKIN_TONE_LIGHT = "\u{1F3FB}";

const VS15 = "\u{FE0E}";
const VS16 = "\u{FE0F}";

const ICE_CUBE_TRIPLE = `${ICE}${ICE}${ICE}`;
const ENCODED_ICE_CUBE_TRIPLE = "%F0%9F%A7%8A%F0%9F%A7%8A%F0%9F%A7%8A";

/**
 * Whether `value` is exactly one code point, written without spreading the
 * string — `no-misused-spread` rightly flags that.
 */
function isSingleCodePoint(value: string): boolean {
  const first = value.codePointAt(0);
  return first !== undefined && String.fromCodePoint(first) === value;
}

function countCodePoints(value: string): number {
  let count = 0;
  for (let index = 0; index < value.length;) {
    const code = value.codePointAt(index);
    if (code === undefined) {
      break;
    }
    index += String.fromCodePoint(code).length;
    count += 1;
  }
  return count;
}

describe("canonicalise", () => {
  it("claims exactly three emoji, matching ADR-0004 decision 2", () => {
    expect(HANDLE_LENGTH).toBe(3);
  });

  it("decodes a percent-encoded segment to the bare code-point key", () => {
    const result = canonicalise(ENCODED_ICE_CUBE_TRIPLE);

    expect(result).toMatchObject({
      ok: true,
      key: ICE_CUBE_TRIPLE,
      encoded: ENCODED_ICE_CUBE_TRIPLE,
      isCanonical: true,
    });
  });

  it("names the three emoji it resolved, in order", () => {
    const result = canonicalise(`${ICE}${CAT}${SOCCER_BALL}`);

    if (!result.ok) {
      throw new Error(`expected a Handle, got ${result.reason}`);
    }
    expect(result.emoji.map((entry) => entry.spokenName)).toEqual([
      "ice",
      "cat",
      "soccer ball",
    ]);
  });

  it("gives a key that is three code points and nothing else", () => {
    const result = canonicalise(`${ICE}${VS16}${SOCCER_BALL}${CAT}`);

    if (!result.ok) {
      throw new Error(`expected a Handle, got ${result.reason}`);
    }
    expect(countCodePoints(result.key)).toBe(HANDLE_LENGTH);
    expect(result.key).toBe(`${ICE}${SOCCER_BALL}${CAT}`);
  });

  describe("strips the variation selectors NFC cannot remove", () => {
    it.each([
      ["U+FE0F on every emoji", `${ICE}${VS16}${ICE}${VS16}${ICE}${VS16}`],
      ["U+FE0F on one emoji", `${ICE}${ICE}${VS16}${ICE}`],
      ["U+FE0E, the text presentation selector", `${ICE}${VS15}${ICE}${ICE}`],
      ["both selectors mixed", `${ICE}${VS16}${ICE}${VS15}${ICE}`],
      [
        "the percent-encoded U+FE0F form",
        `${ENCODED_ICE_CUBE_TRIPLE}%EF%B8%8F`,
      ],
    ])("%s", (_label, input) => {
      const result = canonicalise(input);

      expect(result).toMatchObject({ ok: true, key: ICE_CUBE_TRIPLE });
    });

    it("marks a variation-selector spelling as non-canonical, so #53 redirects", () => {
      const result = canonicalise(`${ENCODED_ICE_CUBE_TRIPLE}%EF%B8%8F`);

      expect(result).toMatchObject({
        ok: true,
        isCanonical: false,
        encoded: ENCODED_ICE_CUBE_TRIPLE,
      });
    });

    it("marks lower-case percent-encoding as non-canonical", () => {
      const result = canonicalise(ENCODED_ICE_CUBE_TRIPLE.toLowerCase());

      expect(result).toMatchObject({
        ok: true,
        key: ICE_CUBE_TRIPLE,
        isCanonical: false,
      });
    });
  });

  describe("rejects malformed percent-encoding rather than throwing", () => {
    it.each([
      ["a truncated UTF-8 sequence", "%F0%9F"],
      ["a bare percent", "%"],
      ["a non-hex escape", "%zz"],
      ["a lone continuation byte", "%8A"],
      ["a truncated escape at the end", `${ENCODED_ICE_CUBE_TRIPLE}%F0%9F%A7`],
    ])("%s", (_label, input) => {
      expect(() => canonicalise(input)).not.toThrow();
      expect(canonicalise(input)).toEqual({
        ok: false,
        reason: "malformed-encoding",
      });
    });
  });

  describe("rejects anything that is not three released emoji", () => {
    it.each([
      ["nothing at all", "", 0],
      ["one emoji, which is Reserved", ICE, 1],
      ["two emoji, which are Reserved", `${ICE}${ICE}`, 2],
      ["four emoji", `${ICE}${ICE}${ICE}${ICE}`, 4],
      [
        "three emoji plus a stray letter",
        `${ICE}${ICE}${ICE}a`,
        HANDLE_LENGTH + 1,
      ],
    ])("%s", (_label, input, length) => {
      expect(canonicalise(input)).toEqual({
        ok: false,
        reason: "wrong-length",
        length,
      });
    });

    it("decodes exactly once, so a double-encoded segment is not a Handle", () => {
      // Decoding twice would resolve this to a valid Handle. Decoding once
      // yields the 36 ASCII characters of the inner escape sequence.
      const doubleEncoded = encodeURIComponent(ENCODED_ICE_CUBE_TRIPLE);

      expect(canonicalise(doubleEncoded)).toEqual({
        ok: false,
        reason: "wrong-length",
        length: ENCODED_ICE_CUBE_TRIPLE.length,
      });
    });

    it("rejects an unreleased category with its own reason and category", () => {
      expect(canonicalise(`${ICE}${GRINNING_FACE}${ICE}`)).toEqual({
        ok: false,
        reason: "unreleased-category",
        codepoint: GRINNING_FACE,
        category: "Smileys & Emotion",
      });
    });

    it("rejects the deferred Objects category too", () => {
      expect(canonicalise(`${FLOPPY_DISK}${ICE}${ICE}`)).toEqual({
        ok: false,
        reason: "unreleased-category",
        codepoint: FLOPPY_DISK,
        category: "Objects",
      });
    });

    it.each([
      ["a letter", `${ICE}a${ICE}`, "a"],
      ["an emoji outside the candidate list", `${ICE}${EYE}${ICE}`, EYE],
      ["a zero-width joiner", `${ICE}${ZWJ}${ICE}`, ZWJ],
      [
        "a skin-tone modifier",
        `${ICE}${SKIN_TONE_LIGHT}${ICE}`,
        SKIN_TONE_LIGHT,
      ],
    ])("rejects %s as an unknown code point", (_label, input, codepoint) => {
      expect(canonicalise(input)).toEqual({
        ok: false,
        reason: "unknown-codepoint",
        codepoint,
      });
    });

    it("rejects a ZWJ sequence that is three code points once the selectors go", () => {
      // 👁️‍🗨️ is U+1F441 U+FE0F U+200D U+1F5E8 U+FE0F. Stripping the variation
      // selectors leaves exactly three code points, so it survives the length
      // check and is only caught by Emoji Set membership. A generator drawing
      // from the released set can never produce this case.
      const eyeInSpeechBubble = `${EYE}${VS16}${ZWJ}${SPEECH_BUBBLE}${VS16}`;

      const withoutSelectors = eyeInSpeechBubble
        .split(VS16)
        .join("")
        .split(VS15)
        .join("");
      expect(countCodePoints(withoutSelectors)).toBe(HANDLE_LENGTH);
      expect(canonicalise(eyeInSpeechBubble)).toEqual({
        ok: false,
        reason: "unknown-codepoint",
        codepoint: EYE,
      });
    });

    it("reports the leftmost offender when a Handle has more than one", () => {
      // Deterministic first-offender scanning: an unreleased emoji to the left
      // of an unknown code point wins, and vice versa. Without this the reason
      // #53 renders would flip with the order of the candidate data.
      expect(canonicalise(`${GRINNING_FACE}${EYE}${ICE}`)).toMatchObject({
        reason: "unreleased-category",
        codepoint: GRINNING_FACE,
      });
      expect(canonicalise(`${EYE}${GRINNING_FACE}${ICE}`)).toMatchObject({
        reason: "unknown-codepoint",
        codepoint: EYE,
      });
    });

    it("checks length before membership, so a long invalid input is wrong-length", () => {
      expect(canonicalise(`${EYE}${EYE}${EYE}${EYE}`)).toMatchObject({
        reason: "wrong-length",
      });
    });
  });

  it("does not treat a leading slash as part of the Handle", () => {
    // The caller passes the decoded-or-encoded segment, never the whole path.
    expect(canonicalise(`/${ICE_CUBE_TRIPLE}`)).toMatchObject({
      ok: false,
      reason: "wrong-length",
    });
  });

  it("accepts repetition, including all-same triples (ADR-0004 decision 2)", () => {
    expect(canonicalise(ICE_CUBE_TRIPLE)).toMatchObject({ ok: true });
    expect(canonicalise(`${RED_APPLE}${RED_APPLE}${CAT}`)).toMatchObject({
      ok: true,
      key: `${RED_APPLE}${RED_APPLE}${CAT}`,
    });
  });
});

/**
 * Carried over from #49. `findEmojiByCodepoint` builds its map from the `emoji`
 * field of the whole candidate list with nothing asserting that field is
 * unique. A duplicate would silently collapse the map — one entry would shadow
 * the other and every existing test would still pass. `canonicalise` exercises
 * that lookup harder than anything else in the product will, so the assertion
 * lives here.
 */
describe("the code-point lookup canonicalise depends on", () => {
  it("holds a unique code point per candidate, so no entry can shadow another", () => {
    const codePoints = candidateEmojiSet.map((entry) => entry.emoji);
    const duplicates = codePoints.filter(
      (codePoint, index) => codePoints.indexOf(codePoint) !== index,
    );

    expect(duplicates).toEqual([]);
    // Covers the whole candidate list, not just the released subset: the map is
    // built from every candidate, so a duplicate anywhere collapses it.
    expect(new Set(codePoints).size).toBe(candidateEmojiSet.length);
  });

  it("is NFC-stable, so applying NFC never rewrites a key", () => {
    // ADR-0004 decision 1 applies NFC before splitting. That is only safe
    // while normalisation is the identity over the set: if a future candidate
    // had a canonical decomposition, NFC would change its code points and the
    // key would stop being the thing the picker showed.
    const rewritten = candidateEmojiSet.filter(
      (entry) =>
        entry.emoji.normalize("NFC") !== entry.emoji ||
        entry.emoji.normalize("NFD") !== entry.emoji,
    );

    expect(rewritten).toEqual([]);
  });

  it("is not NFKC-stable, which is why the rule says NFC and not NFKC", () => {
    // Compatibility normalisation rewrites 13 Symbols candidates into plain
    // CJK characters — U+1F233 becomes U+7A7A. A caller that "helpfully"
    // applied NFKC before calling canonicalise would turn a real emoji into an
    // unknown code point, so this is a constraint on callers, not a defect.
    const vacancyButton = "\u{1F233}";
    const ideograph = "\u{7A7A}";

    expect(vacancyButton.normalize("NFKC")).toBe(ideograph);
    expect(canonicalise(`${ICE}${vacancyButton}${ICE}`)).toMatchObject({
      reason: "unreleased-category",
      category: "Symbols",
    });
    expect(
      canonicalise(`${ICE}${vacancyButton.normalize("NFKC")}${ICE}`),
    ).toMatchObject({
      reason: "unknown-codepoint",
      codepoint: ideograph,
    });
  });

  it("holds one code point per candidate, so a key is always three characters wide in code points", () => {
    const sequences = candidateEmojiSet.filter(
      (entry) => !isSingleCodePoint(entry.emoji),
    );

    expect(sequences).toEqual([]);
  });
});
