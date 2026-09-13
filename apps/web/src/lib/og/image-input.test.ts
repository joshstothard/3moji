import type { Profile, ProfileState } from "@template/core";
import type { AvailabilityState } from "../../components/availability-state";
import { glyphDataUriOf } from "./glyphs";
import { GENERIC_IMAGE, ogImageInputOf } from "./image-input";

const ICE = "\u{1F9CA}";
const HANDLE = {
  key: `${ICE}${ICE}${ICE}`,
  emoji: [{ emoji: ICE }, { emoji: ICE }, { emoji: ICE }],
};

/** Something in every field, so a leak of any of them is visible. */
const PROFILE: Profile = {
  displayName: "Zoe Frost",
  bio: "Cold takes only.",
  links: [
    {
      id: "l1",
      title: "Zebra zine",
      url: "https://zine.example/z",
      position: 0,
    },
  ],
  updatedAt: new Date("2026-09-01T00:00:00.000Z"),
};
const WITH_PROFILE: ProfileState = { state: "profile", profile: PROFILE };

describe("the Open Graph image input for a claimed Handle", () => {
  it("draws the Handle's three emoji as bundled glyphs, with the display name", () => {
    const glyph = glyphDataUriOf(ICE);

    expect(ogImageInputOf(HANDLE, "claimed", WITH_PROFILE)).toEqual({
      kind: "handle",
      glyphs: [glyph, glyph, glyph],
      displayName: "Zoe Frost",
    });
  });

  it("draws the emoji alone for a Handle whose owner has edited nothing", () => {
    const glyph = glyphDataUriOf(ICE);
    const input = ogImageInputOf(HANDLE, "claimed", { state: "unedited" });

    expect(glyph).toMatch(/^data:image\/svg\+xml;base64,/);
    expect(input).toEqual({
      kind: "handle",
      glyphs: [glyph, glyph, glyph],
      displayName: undefined,
    });
  });

  it("draws the emoji alone when the display name was never set", () => {
    const glyph = glyphDataUriOf(ICE);
    const input = ogImageInputOf(HANDLE, "claimed", {
      state: "profile",
      profile: { ...PROFILE, displayName: null },
    });

    expect(input).toEqual({
      kind: "handle",
      glyphs: [glyph, glyph, glyph],
      displayName: undefined,
    });
  });

  it("bounds the display name before it reaches the image", () => {
    const input = ogImageInputOf(HANDLE, "claimed", {
      state: "profile",
      profile: { ...PROFILE, displayName: `Zoe\u202E${"a".repeat(40)}` },
    });

    expect(input).toMatchObject({
      kind: "handle",
      displayName: `Zoe ${"a".repeat(26)}`,
    });
  });

  it("leaves out a name the bundled font cannot draw, rather than fetching a font for it", () => {
    const input = ogImageInputOf(HANDLE, "claimed", {
      state: "profile",
      profile: { ...PROFILE, displayName: "山田太郎" },
    });

    expect(input).toMatchObject({ kind: "handle", displayName: undefined });
  });

  it("never carries the bio or a Link", () => {
    const serialised = JSON.stringify(
      ogImageInputOf(HANDLE, "claimed", WITH_PROFILE),
    );

    expect(serialised).not.toContain(PROFILE.bio);
    expect(serialised).not.toContain("zine.example");
    expect(serialised).not.toContain("Zebra zine");
  });

  it("is the generic image when an emoji has no bundled glyph", () => {
    // 😀 is outside the released set, so it has no glyph. Drawing two emoji
    // and a gap would misstate the Handle.
    const grin = "\u{1F600}";
    const input = ogImageInputOf(
      {
        key: `${ICE}${ICE}${grin}`,
        emoji: [{ emoji: ICE }, { emoji: ICE }, { emoji: grin }],
      },
      "claimed",
      WITH_PROFILE,
    );

    expect(input).toEqual(GENERIC_IMAGE);
  });

  it("is the generic image when the Profile read failed", () => {
    expect(ogImageInputOf(HANDLE, "claimed", { state: "none" })).toEqual(
      GENERIC_IMAGE,
    );
  });
});

/**
 * ADR-0004: who holds a Handle and when a hold expires never leave
 * `packages/core`. The Profile is forced at every non-claimed state here — the
 * hostile case — because "the read never returned one" is not evidence that
 * the image would not draw one it was handed.
 */
describe("the Open Graph image input for every Handle that is not claimed", () => {
  const NOT_CLAIMED: readonly AvailabilityState[] = [
    "available",
    "held",
    "not-claimable",
    "unknown",
    "not-a-handle",
  ];

  it.each(NOT_CLAIMED)(
    "is exactly the generic image for a %s Handle, even when handed a Profile",
    (state) => {
      const input = ogImageInputOf(HANDLE, state, WITH_PROFILE);
      const serialised = JSON.stringify(input);

      expect(input).toEqual(GENERIC_IMAGE);
      expect(serialised).not.toContain("Zoe Frost");
      expect(serialised).not.toContain("2026");
      expect(serialised).not.toMatch(/held|hold|reserved|expir/i);
      expect(serialised).not.toContain(glyphDataUriOf(ICE));
    },
  );
});
