import { readFileSync } from "node:fs";
import path from "node:path";
import {
  boundedDisplayName,
  IMAGE_FONT_RANGES,
  isDrawableInImage,
} from "./display-name";
import en from "../../../../../packages/shared/messages/en.json";

const ICE = "\u{1F9CA}";

describe("boundedDisplayName", () => {
  it("carries nothing for a display name that was never set", () => {
    expect(boundedDisplayName(null)).toBeUndefined();
  });

  it("carries nothing for a name that is only whitespace and controls", () => {
    expect(boundedDisplayName(" \t\u0000\u202E ")).toBeUndefined();
  });

  it("keeps an ordinary name exactly", () => {
    expect(boundedDisplayName("Zoe Frost")).toBe("Zoe Frost");
  });

  it("removes a bidirectional override, which would reorder somebody else's unfurl", () => {
    expect(boundedDisplayName("Zoe\u202EtsorF")).toBe("Zoe tsorF");
  });

  it("collapses line breaks, so a name cannot add lines to a <meta> value", () => {
    expect(boundedDisplayName("Zoe\r\n\n  Frost")).toBe("Zoe Frost");
  });

  it("cuts to 30 code points, counting an emoji as one", () => {
    // 31 astral emoji are 62 UTF-16 units: a `String.length` cut would keep 15.
    const bounded = boundedDisplayName(ICE.repeat(31));

    expect(Array.from(bounded ?? "")).toHaveLength(30);
  });

  it("cuts a long Latin name to 30 characters", () => {
    expect(boundedDisplayName("a".repeat(45))).toBe("a".repeat(30));
  });
});

describe("isDrawableInImage", () => {
  it.each(["Zoe Frost", "Zoë Łukasz-Nguyễn", "Ада Лавлейс", "O'Brien & co."])(
    "draws %s with the bundled font",
    (name) => {
      expect(isDrawableInImage(name)).toBe(true);
    },
  );

  it.each([
    ["a CJK name", "山田太郎"],
    ["an emoji", `Ice ${ICE}`],
    ["an Arabic name", "زينب"],
  ])(
    "refuses %s, which would make next/og fetch a font with the name in the URL",
    (_label, name) => {
      expect(isDrawableInImage(name)).toBe(false);
    },
  );

  it("can draw every word the image itself prints", () => {
    expect(isDrawableInImage(en.OpenGraph.siteName)).toBe(true);
    expect(isDrawableInImage(en.OpenGraph.imageTagline)).toBe(true);
  });
});

/**
 * The code points `IMAGE_FONT_RANGES` promises, read back from the font that
 * actually ships with the installed `next`. If a Next.js upgrade swaps the
 * bundled font, this is what goes red — rather than a Profile image quietly
 * starting to fetch Google Fonts with display names in the query string.
 */
describe("IMAGE_FONT_RANGES against next/og's bundled font", () => {
  function mappedCodepoints(font: Buffer): Set<number> {
    const tables = font.readUInt16BE(4);
    let cmap = -1;
    for (let index = 0; index < tables; index += 1) {
      const record = 12 + index * 16;
      if (font.toString("latin1", record, record + 4) === "cmap") {
        cmap = font.readUInt32BE(record + 8);
      }
    }
    if (cmap < 0) throw new Error("The font has no cmap table.");

    const mapped = new Set<number>();
    const subtables = font.readUInt16BE(cmap + 2);
    for (let index = 0; index < subtables; index += 1) {
      const offset = cmap + font.readUInt32BE(cmap + 4 + index * 8 + 4);
      const format = font.readUInt16BE(offset);
      if (format === 4) {
        const doubled = font.readUInt16BE(offset + 6);
        const ends = offset + 14;
        const starts = ends + doubled + 2;
        const deltas = starts + doubled;
        const rangeOffsets = deltas + doubled;
        for (let segment = 0; segment < doubled / 2; segment += 1) {
          const end = font.readUInt16BE(ends + segment * 2);
          const start = font.readUInt16BE(starts + segment * 2);
          const delta = font.readUInt16BE(deltas + segment * 2);
          const rangeOffset = font.readUInt16BE(rangeOffsets + segment * 2);
          for (let code = start; code <= end && code !== 0xffff; code += 1) {
            const glyph =
              rangeOffset === 0
                ? (code + delta) & 0xffff
                : font.readUInt16BE(
                    rangeOffsets +
                      segment * 2 +
                      rangeOffset +
                      (code - start) * 2,
                  );
            if (glyph !== 0) mapped.add(code);
          }
        }
      } else if (format === 12) {
        const groups = font.readUInt32BE(offset + 12);
        for (let group = 0; group < groups; group += 1) {
          const record = offset + 16 + group * 12;
          const last = font.readUInt32BE(record + 4);
          for (let code = font.readUInt32BE(record); code <= last; code += 1) {
            mapped.add(code);
          }
        }
      }
    }
    return mapped;
  }

  it("maps every code point the image is allowed to draw", () => {
    const fontPath = path.join(
      path.dirname(require.resolve("next/package.json")),
      "dist/compiled/@vercel/og/Geist-Regular.ttf",
    );
    const mapped = mappedCodepoints(readFileSync(fontPath));

    const unmapped: string[] = [];
    for (const [first, last] of IMAGE_FONT_RANGES) {
      for (let code = first; code <= last; code += 1) {
        if (!mapped.has(code)) unmapped.push(code.toString(16));
      }
    }

    expect(unmapped).toEqual([]);
  });
});
