import { releasedEmojiSet } from "@template/core/browser";
import { EMOJI_GLYPHS } from "./emoji-glyphs.generated";
import { glyphDataUriOf } from "./glyphs";

const DATA_URI_PREFIX = "data:image/svg+xml;base64,";

function decoded(uri: string): string {
  return Buffer.from(uri.slice(DATA_URI_PREFIX.length), "base64").toString(
    "utf8",
  );
}

describe("the bundled emoji glyphs", () => {
  it("has a glyph for every emoji in the released Emoji Set", () => {
    // A category drop is a one-line edit to RELEASED_CATEGORIES. Without this,
    // a Handle drawn from the new category would get the generic image and
    // nobody would notice; with it, the drop fails until
    // `node scripts/generate-og-glyphs.mjs` is re-run.
    const missing = releasedEmojiSet
      .filter((entry) => glyphDataUriOf(entry.emoji) === undefined)
      .map((entry) => entry.codepoint);

    expect(missing).toEqual([]);
  });

  it("covers single code points only, which is what the file names assume", () => {
    const sequences = releasedEmojiSet.filter(
      (entry) => Array.from(entry.emoji).length !== 1,
    );

    expect(sequences).toEqual([]);
  });

  it("draws an emoji as a self-contained SVG data URI", () => {
    const uri = glyphDataUriOf("\u{1F9CA}");

    expect(uri?.startsWith(DATA_URI_PREFIX)).toBe(true);
    expect(decoded(uri ?? "")).toBe(EMOJI_GLYPHS.get("\u{1F9CA}"));
  });

  it("embeds nothing a renderer could be made to fetch", () => {
    const outward = [...EMOJI_GLYPHS.entries()]
      .filter(([, svg]) =>
        /<script|<image|<foreignObject|href|url\(|@import/i.test(svg),
      )
      .map(([emoji]) => emoji);

    expect(outward).toEqual([]);
  });

  it("has no glyph for an emoji outside the released set", () => {
    // 😀 is a candidate in an unreleased category.
    expect(glyphDataUriOf("\u{1F600}")).toBeUndefined();
  });
});
