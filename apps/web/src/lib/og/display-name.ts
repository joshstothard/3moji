import { DISPLAY_NAME_MAX_LENGTH } from "@template/core/browser";

/**
 * A display name as the Open Graph metadata and image may carry it, or
 * `undefined` when there is nothing to carry
 * ([#161](https://github.com/joshstothard/3moji/issues/161)).
 *
 * The name was typed by the owner, and it leaves the page here: into `<meta>`
 * content that another site renders, and into an image. So it is re-bounded at
 * this edge rather than trusted to have been bounded at the write
 * (`docs/development/engineering-standards.md` § Security, defence in depth):
 *
 * - **Control and format characters are removed.** `\p{Cc}` covers C0/C1
 *   controls and line breaks; `\p{Cf}` covers the bidirectional overrides that
 *   would let a name reorder the text around it in somebody else's unfurl.
 * - **Whitespace is collapsed and trimmed**, so a title cannot be padded out
 *   into a blank card.
 * - **It is cut to `DISPLAY_NAME_MAX_LENGTH` code points**, the limit
 *   `validateProfile` enforces, counted the same way.
 *
 * Nothing here escapes markup, and nothing needs to: Next.js writes metadata
 * through React, which escapes attribute values, and the image draws the name
 * as a satori text node, which is laid out as glyphs and never parsed.
 */
export function boundedDisplayName(
  displayName: string | null,
): string | undefined {
  if (displayName === null) return undefined;

  const cleaned = displayName
    .replace(/[\p{Cc}\p{Cf}]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
  const bounded = Array.from(cleaned)
    .slice(0, DISPLAY_NAME_MAX_LENGTH)
    .join("")
    .trim();

  return bounded === "" ? undefined : bounded;
}

/**
 * The code points `next/og`'s bundled font (Geist Regular) can draw, as
 * inclusive ranges: Latin, Latin-1, Latin Extended-A, most of Cyrillic and
 * common punctuation, read from the font's own `cmap`. Combining marks and the
 * private-use area are left out even where the font maps them.
 *
 * `display-name.test.ts` re-reads the font that ships with the installed
 * `next` and fails if any code point here stops being mapped.
 */
export const IMAGE_FONT_RANGES: readonly (readonly [number, number])[] = [
  [0x20, 0x7e],
  [0xa0, 0xac],
  [0xae, 0x113],
  [0x116, 0x12b],
  [0x12e, 0x137],
  [0x139, 0x13e],
  [0x141, 0x148],
  [0x14a, 0x14d],
  [0x150, 0x17e],
  [0x400, 0x45f],
  [0x1e9e, 0x1e9e],
  [0x1ea0, 0x1ef9],
  [0x2013, 0x2014],
  [0x2018, 0x201a],
  [0x201c, 0x201e],
  [0x2020, 0x2022],
  [0x2026, 0x2026],
  [0x2030, 0x2030],
  [0x2039, 0x203a],
  [0x20ac, 0x20ac],
  [0x2122, 0x2122],
];

function isDrawable(codepoint: number): boolean {
  return IMAGE_FONT_RANGES.some(
    ([first, last]) => codepoint >= first && codepoint <= last,
  );
}

/**
 * Whether the image can draw `name` with its bundled font alone.
 *
 * **This is a privacy rule, not a typographic one.** When satori meets a
 * character none of its fonts has, `next/og` fetches a fallback font from
 * Google Fonts with **the text itself in the query string**, and logs the text
 * if that fails. Drawing such a name would send the owner's display name to a
 * third party on every render. So a name with any character outside
 * {@link IMAGE_FONT_RANGES} is left out of the image — the Handle's emoji are
 * still drawn — and it stays in the text metadata, which no font renders.
 */
export function isDrawableInImage(name: string): boolean {
  for (const character of name) {
    const codepoint = character.codePointAt(0);
    if (codepoint === undefined || !isDrawable(codepoint)) return false;
  }
  return true;
}
