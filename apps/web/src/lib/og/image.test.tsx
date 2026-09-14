import type { ReactElement } from "react";
import { render } from "@testing-library/react";
import en from "../../../../../packages/shared/messages/en.json";
import { GENERIC_IMAGE, type OgImageInput } from "./image-input";

/**
 * `next/og` renders with WebAssembly, which this jsdom suite cannot run, so
 * the constructor is recorded instead. What belongs here is what the response
 * is built from — the element and the options, headers included. The PNG
 * itself is `apps/web/e2e/profile-open-graph.spec.ts`'s.
 */
const mockConstructed: { element: ReactElement; options: unknown }[] = [];
jest.mock("next/og", () => ({
  ImageResponse: class {
    /** Marks the recorded stand-in, so it is never mistaken for a PNG. */
    readonly fake = true;

    constructor(element: ReactElement, options: unknown) {
      mockConstructed.push({ element, options });
    }
  },
}));

import { OG_IMAGE_CACHE_CONTROL, ogImageResponse } from "./image";

const GLYPH = "data:image/svg+xml;base64,PHN2Zy8+";
const PROFILE_INPUT: OgImageInput = {
  kind: "handle",
  glyphs: [GLYPH, GLYPH, GLYPH],
  displayName: "Zoe Frost",
};

function built(input: OgImageInput): {
  element: ReactElement;
  options: unknown;
} {
  mockConstructed.length = 0;
  ogImageResponse(input);
  const [only] = mockConstructed;
  if (only === undefined) throw new Error("No ImageResponse was constructed.");
  return only;
}

describe("the Open Graph image response", () => {
  it("is a 1200×630 image with a short, revalidating cache lifetime", () => {
    // Five minutes: a renamed or deleted Profile stops unfurling its old name
    // within that, where next/og's default would cache it for a year.
    expect(OG_IMAGE_CACHE_CONTROL).toBe("public, max-age=300, s-maxage=300");
    expect(built(PROFILE_INPUT).options).toEqual({
      width: 1200,
      height: 630,
      headers: { "cache-control": OG_IMAGE_CACHE_CONTROL },
    });
  });

  it("answers the generic image with exactly the same options, so headers cannot tell them apart", () => {
    expect(built(GENERIC_IMAGE).options).toEqual(built(PROFILE_INPUT).options);
  });

  it("draws the three glyphs as images and the display name as text", () => {
    const { container } = render(built(PROFILE_INPUT).element);

    const images = Array.from(container.querySelectorAll("img"));
    expect(images.map((image) => image.getAttribute("src"))).toEqual([
      GLYPH,
      GLYPH,
      GLYPH,
    ]);
    expect(container.textContent).toContain("Zoe Frost");
  });

  it("draws the glyphs alone when there is no name to draw", () => {
    const { container } = render(
      built({ ...PROFILE_INPUT, displayName: undefined }).element,
    );

    expect(container.querySelectorAll("img")).toHaveLength(3);
    expect(container.textContent).toBe(en.OpenGraph.siteName);
  });

  describe("in the 3moji brand (#272)", () => {
    /** jsdom reports an inline colour as `rgb(r, g, b)`. */
    const PAPER = "rgb(251, 248, 244)";
    const INK = "rgb(26, 21, 35)";
    const VIOLET = "rgb(91, 61, 245)";
    const MUTED = "rgb(115, 108, 126)";

    function colours(input: OgImageInput): {
      readonly backgrounds: readonly string[];
      readonly text: readonly string[];
    } {
      const { container } = render(built(input).element);
      const elements = Array.from(container.querySelectorAll("div"));
      return {
        backgrounds: elements
          .map((element) => element.style.backgroundColor)
          .filter((colour) => colour !== ""),
        text: elements
          .map((element) => element.style.color)
          .filter((colour) => colour !== ""),
      };
    }

    it("draws a Profile's card on paper, the name in ink and the site's name in violet", () => {
      expect(colours(PROFILE_INPUT)).toEqual({
        backgrounds: [PAPER],
        text: [INK, VIOLET],
      });
    });

    it("draws the generic card on paper, the site's name in violet and the tagline muted", () => {
      expect(colours(GENERIC_IMAGE)).toEqual({
        backgrounds: [PAPER],
        text: [VIOLET, MUTED],
      });
    });
  });

  it("draws the generic image from the site's own words and no glyph", () => {
    const { container } = render(built(GENERIC_IMAGE).element);

    expect(container.querySelectorAll("img")).toHaveLength(0);
    expect(container.textContent).toBe(
      `${en.OpenGraph.siteName}${en.OpenGraph.imageTagline}`,
    );
  });
});
