import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * The favicon wears the 3moji brand
 * ([#272](https://github.com/joshstothard/3moji/issues/272)): a violet tile
 * with three paper dots, not the indigo it had before the brand pass (#251).
 *
 * Read as a file, because Next.js serves `app/icon.svg` as it is.
 */
const svg = readFileSync(join(__dirname, "icon.svg"), "utf8").toLowerCase();

function fills(): readonly string[] {
  return Array.from(svg.matchAll(/fill="(#[0-9a-f]{3,6})"/g), (match) =>
    String(match[1]),
  );
}

describe("the favicon", () => {
  it("is a brand violet tile with three paper dots", () => {
    expect(fills()).toEqual(["#5b3df5", "#fbf8f4", "#fbf8f4", "#fbf8f4"]);
  });

  it("keeps none of the old indigo", () => {
    expect(svg).not.toContain("#4f46e5");
  });
});
