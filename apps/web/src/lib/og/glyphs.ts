import { EMOJI_GLYPHS } from "./emoji-glyphs.generated";

/**
 * The image an emoji is drawn with in an Open Graph image, as a `data:` URI, or
 * `undefined` when there is no bundled glyph for it
 * ([#161](https://github.com/joshstothard/3moji/issues/161)).
 *
 * **Why an image and not text.** `next/og` draws text with satori, which cannot
 * render a colour emoji font, and which answers a glyph missing from its fonts
 * by fetching one from a CDN at request time. Handing it an `<img>` whose
 * source is already in memory means rendering a Profile image makes no network
 * request, so it cannot fail, slow down or tell a third party which Handle was
 * asked for.
 *
 * The glyphs are Twemoji's, CC-BY 4.0; see `emoji-glyphs.generated.ts` for the
 * pinned version and `TWEMOJI-LICENSE-GRAPHICS.txt` for the licence.
 */
export function glyphDataUriOf(emoji: string): string | undefined {
  const svg = EMOJI_GLYPHS.get(emoji);
  if (svg === undefined) return undefined;
  return `data:image/svg+xml;base64,${Buffer.from(svg, "utf8").toString("base64")}`;
}
