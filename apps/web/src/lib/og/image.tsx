import { ImageResponse } from "next/og";
import type { OgImageInput } from "./image-input";
import { OG_IMAGE_HEIGHT, OG_IMAGE_WIDTH } from "./metadata";
import en from "../../../../../packages/shared/messages/en.json";

const copy = en.OpenGraph;

/**
 * The cache lifetime of every Open Graph image, generic or not
 * ([#161](https://github.com/joshstothard/3moji/issues/161)).
 *
 * **Five minutes, and never `immutable`.** `next/og` defaults to a year, which
 * would keep an owner's old display name — or the name of an Account since
 * deleted — in every CDN and unfurl cache that fetched it. Five minutes bounds
 * that, and a render is cheap enough to repeat. It is one value for both kinds
 * of image, so a header cannot tell a Profile's image from the generic one.
 */
export const OG_IMAGE_CACHE_CONTROL = "public, max-age=300, s-maxage=300";

/**
 * The brand's own tokens (#251), as `app/globals.css` declares them: `paper`,
 * `ink`, `violet` and `muted`. Satori draws from inline styles, not the
 * stylesheet, so they are repeated here rather than read (#272).
 */
const PAPER = "#fbf8f4";
const INK = "#1a1523";
const MUTED = "#736c7e";
const VIOLET = "#5b3df5";

const GLYPH_SIZE = 220;

/**
 * The PNG for `input`, 1200×630.
 *
 * Satori lays out a subset of CSS: every element with more than one child is a
 * flex container, and every `<img>` has an explicit size. The glyphs are
 * `data:` URIs, so nothing is fetched while drawing; the display name is a
 * text node in the bundled font, and `ogImageInputOf` has already left out any
 * name that font could not draw.
 */
export function ogImageResponse(input: OgImageInput): ImageResponse {
  return new ImageResponse(
    input.kind === "generic" ? (
      <GenericCard />
    ) : (
      <HandleCard glyphs={input.glyphs} displayName={input.displayName} />
    ),
    {
      width: OG_IMAGE_WIDTH,
      height: OG_IMAGE_HEIGHT,
      headers: { "cache-control": OG_IMAGE_CACHE_CONTROL },
    },
  );
}

function Frame({ children }: { readonly children: React.ReactNode }) {
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: PAPER,
      }}
    >
      {children}
    </div>
  );
}

function HandleCard({
  glyphs,
  displayName,
}: {
  readonly glyphs: readonly string[];
  readonly displayName: string | undefined;
}) {
  return (
    <Frame>
      <div style={{ display: "flex", gap: 36 }}>
        {glyphs.map((glyph, index) => (
          // The accessible description of this image is the `og:image:alt`
          // metadata; inside the PNG an `alt` is never read by anybody.
          // eslint-disable-next-line @next/next/no-img-element -- satori draws plain <img>; next/image cannot render inside ImageResponse
          <img
            key={index}
            src={glyph}
            alt=""
            width={GLYPH_SIZE}
            height={GLYPH_SIZE}
          />
        ))}
      </div>
      {displayName !== undefined && (
        <div
          style={{
            display: "flex",
            marginTop: 48,
            fontSize: 68,
            color: INK,
          }}
        >
          {displayName}
        </div>
      )}
      <div
        style={{
          display: "flex",
          marginTop: displayName === undefined ? 56 : 28,
          fontSize: 36,
          color: VIOLET,
        }}
      >
        {copy.siteName}
      </div>
    </Frame>
  );
}

function GenericCard() {
  return (
    <Frame>
      <div style={{ display: "flex", fontSize: 160, color: VIOLET }}>
        {copy.siteName}
      </div>
      <div
        style={{
          display: "flex",
          marginTop: 24,
          fontSize: 52,
          color: MUTED,
        }}
      >
        {copy.imageTagline}
      </div>
    </Frame>
  );
}
