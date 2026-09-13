import type { Profile, ProfileState } from "@template/core";
import type { AvailabilityState } from "../../components/availability-state";
import {
  GENERIC_IMAGE_PATH,
  genericMetadataOf,
  handleMetadataOf,
} from "./metadata";

const ICE = "\u{1F9CA}";
const KEY = `${ICE}${ICE}${ICE}`;
const ENCODED = "%F0%9F%A7%8A%F0%9F%A7%8A%F0%9F%A7%8A";
const HANDLE = {
  key: KEY,
  encoded: ENCODED,
  emoji: [{ emoji: ICE }, { emoji: ICE }, { emoji: ICE }],
};
const ORIGIN = "https://3moji.example";
const CANONICAL = `${ORIGIN}/${ENCODED}`;
const PROFILE_IMAGE = `${ORIGIN}/${ENCODED}/og-image`;

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

describe("the metadata of a claimed Handle's page", () => {
  const metadata = handleMetadataOf({
    origin: ORIGIN,
    handle: HANDLE,
    state: "claimed",
    profile: WITH_PROFILE,
  });

  it("titles the card with the display name and the Handle", () => {
    expect(metadata.openGraph?.title).toBe(`Zoe Frost · ${KEY}`);
    expect(metadata.twitter?.title).toBe(`Zoe Frost · ${KEY}`);
  });

  it("describes the Handle by how it is said", () => {
    // `spokenHandle` is the real one (`@template/core/browser` is not mocked).
    expect(metadata.openGraph?.description).toBe(
      "Say it: three ice cubes. A web address you can say out loud, on 3moji.",
    );
    expect(metadata.twitter?.description).toBe(metadata.openGraph?.description);
  });

  it("points og:url and rel=canonical at the absolute, percent-encoded emoji path", () => {
    expect(metadata.openGraph?.url).toBe(CANONICAL);
    expect(metadata.alternates?.canonical).toBe(CANONICAL);
  });

  it("offers a 1200×630 image at the emoji path's image route", () => {
    expect(metadata.openGraph?.images).toEqual([
      {
        url: PROFILE_IMAGE,
        width: 1200,
        height: 630,
        alt: "three ice cubes, Zoe Frost",
      },
    ]);
  });

  it("declares a large-image Twitter card for the same image", () => {
    expect(metadata.twitter).toMatchObject({
      card: "summary_large_image",
      images: [PROFILE_IMAGE],
    });
  });

  it("never carries the bio or a Link", () => {
    const serialised = JSON.stringify(metadata);

    expect(serialised).not.toContain(PROFILE.bio);
    expect(serialised).not.toContain("zine.example");
  });

  it("inserts a display name literally, even one that looks like a replacement pattern", () => {
    const tricky = handleMetadataOf({
      origin: ORIGIN,
      handle: HANDLE,
      state: "claimed",
      profile: {
        state: "profile",
        profile: { ...PROFILE, displayName: "$& $' {handle}" },
      },
    });

    expect(tricky.openGraph?.title).toBe(`$& $' {handle} · ${KEY}`);
  });

  it("bounds and cleans the display name before it reaches a <meta> value", () => {
    const long = handleMetadataOf({
      origin: ORIGIN,
      handle: HANDLE,
      state: "claimed",
      profile: {
        state: "profile",
        profile: { ...PROFILE, displayName: `Zoe\n\u202E${"a".repeat(40)}` },
      },
    });

    expect(long.openGraph?.title).toBe(`Zoe ${"a".repeat(26)} · ${KEY}`);
  });

  it("keeps a name the image cannot draw in the text metadata", () => {
    const cjk = handleMetadataOf({
      origin: ORIGIN,
      handle: HANDLE,
      state: "claimed",
      profile: {
        state: "profile",
        profile: { ...PROFILE, displayName: "山田太郎" },
      },
    });

    expect(cjk.openGraph?.title).toBe(`山田太郎 · ${KEY}`);
  });

  it("titles an unedited Handle by its emoji alone", () => {
    const unedited = handleMetadataOf({
      origin: ORIGIN,
      handle: HANDLE,
      state: "claimed",
      profile: { state: "unedited" },
    });

    expect(unedited.openGraph?.title).toBe(`${KEY} on 3moji`);
    expect(unedited.openGraph?.images).toEqual([
      { url: PROFILE_IMAGE, width: 1200, height: 630, alt: "three ice cubes" },
    ]);
    expect(unedited.alternates?.canonical).toBe(CANONICAL);
  });

  it("is the generic metadata, still canonical, when the Profile read failed", () => {
    expect(
      handleMetadataOf({
        origin: ORIGIN,
        handle: HANDLE,
        state: "claimed",
        profile: { state: "none" },
      }),
    ).toEqual(genericMetadataOf(ORIGIN, `/${ENCODED}`));
  });
});

describe("the generic metadata", () => {
  it("names the site and points at the one generic image", () => {
    const generic = genericMetadataOf(ORIGIN, `/${ENCODED}`);

    expect(generic.openGraph).toMatchObject({
      title: "3moji",
      description: "A web address you can say out loud.",
      url: CANONICAL,
      images: [
        {
          url: `${ORIGIN}${GENERIC_IMAGE_PATH}`,
          width: 1200,
          height: 630,
          alt: "3moji: a web address you can say out loud.",
        },
      ],
    });
    expect(generic.twitter).toMatchObject({
      card: "summary_large_image",
      images: [`${ORIGIN}${GENERIC_IMAGE_PATH}`],
    });
    expect(generic.alternates?.canonical).toBe(CANONICAL);
  });

  it("declares no canonical and no og:url for a page that shows no single Handle", () => {
    const listing = genericMetadataOf(ORIGIN);

    expect(listing.alternates).toBeUndefined();
    expect(listing.openGraph?.url).toBeUndefined();
  });

  it("emits no absolute URL at all when no origin is configured, rather than guessing a host", () => {
    const unconfigured = handleMetadataOf({
      origin: undefined,
      handle: HANDLE,
      state: "claimed",
      profile: WITH_PROFILE,
    });

    expect(unconfigured.alternates?.canonical).toBe(`/${ENCODED}`);
    expect(unconfigured.openGraph?.url).toBeUndefined();
    expect(unconfigured.openGraph?.images).toBeUndefined();
    expect(unconfigured.twitter?.images).toBeUndefined();
    expect(JSON.stringify(unconfigured)).not.toContain("localhost");
  });
});

/**
 * ADR-0004: who holds a Handle and when a hold expires never leave
 * `packages/core`. Each non-claimed state is handed a fully-populated Profile —
 * the hostile case — and must still produce exactly the generic metadata.
 */
describe("the metadata of every Handle that is not claimed", () => {
  const NOT_CLAIMED: readonly AvailabilityState[] = [
    "available",
    "held",
    "not-claimable",
    "unknown",
    "not-a-handle",
  ];

  it.each(NOT_CLAIMED)(
    "is exactly the generic metadata for a %s Handle, even when handed a Profile",
    (state) => {
      const metadata = handleMetadataOf({
        origin: ORIGIN,
        handle: HANDLE,
        state,
        profile: WITH_PROFILE,
      });
      const serialised = JSON.stringify(metadata);

      expect(metadata).toEqual(genericMetadataOf(ORIGIN, `/${ENCODED}`));
      expect(serialised).not.toContain("Zoe Frost");
      expect(serialised).not.toContain("2026");
      expect(serialised).not.toMatch(/held|hold|reserved|expir/i);
      expect(serialised).not.toContain(`${ENCODED}/og-image`);
    },
  );
});
