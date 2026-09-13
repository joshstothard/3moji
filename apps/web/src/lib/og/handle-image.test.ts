import type { Profile, ProfileState } from "@template/core";
import type { AvailabilityState } from "../../components/availability-state";
import { glyphDataUriOf } from "./glyphs";
import { GENERIC_IMAGE } from "./image-input";

const ICE = "\u{1F9CA}";
const ENCODED = "%F0%9F%A7%8A%F0%9F%A7%8A%F0%9F%A7%8A";

interface StubResult {
  readonly ok: boolean;
  readonly key?: string;
  readonly encoded?: string;
  readonly isCanonical?: boolean;
  readonly emoji?: readonly { readonly emoji: string }[];
  readonly reason?: string;
}

const RESOLVED: StubResult = {
  ok: true,
  key: `${ICE}${ICE}${ICE}`,
  encoded: ENCODED,
  isCanonical: true,
  emoji: [{ emoji: ICE }, { emoji: ICE }, { emoji: ICE }],
};

const mockCanonicalise = jest.fn((_segment: string): StubResult => RESOLVED);
jest.mock("@template/core", () => ({
  canonicalise: (segment: string) => mockCanonicalise(segment),
}));

const mockReadAvailability = jest.fn(
  (_segment: string): Promise<AvailabilityState> => Promise.resolve("claimed"),
);
jest.mock("../availability", () => ({
  readAvailability: (segment: string) => mockReadAvailability(segment),
}));

const PROFILE: Profile = {
  displayName: "Zoe Frost",
  bio: "Cold takes only.",
  links: [],
  updatedAt: new Date("2026-09-01T00:00:00.000Z"),
};
const mockReadProfile = jest.fn(
  (_segment: string, _state: AvailabilityState): Promise<ProfileState> =>
    Promise.resolve({ state: "profile", profile: PROFILE }),
);
jest.mock("../profile", () => ({
  readProfile: (segment: string, state: AvailabilityState) =>
    mockReadProfile(segment, state),
}));

import { ogImageInputForSegment } from "./handle-image";

describe("the image input for a requested segment", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCanonicalise.mockReturnValue(RESOLVED);
    mockReadAvailability.mockResolvedValue("claimed");
    mockReadProfile.mockResolvedValue({ state: "profile", profile: PROFILE });
  });

  it("draws a claimed Profile from the same encoded segment both reads were asked about", async () => {
    const glyph = glyphDataUriOf(ICE);

    await expect(ogImageInputForSegment(ENCODED)).resolves.toEqual({
      kind: "handle",
      glyphs: [glyph, glyph, glyph],
      displayName: "Zoe Frost",
    });
    expect(mockCanonicalise).toHaveBeenCalledWith(ENCODED);
    expect(mockReadAvailability).toHaveBeenCalledWith(ENCODED);
    expect(mockReadProfile).toHaveBeenCalledWith(ENCODED, "claimed");
  });

  it.each([
    "available",
    "held",
    "not-claimable",
    "unknown",
    "not-a-handle",
  ] as const)(
    "is the generic image for a %s Handle, even when the Profile read answers one",
    async (state) => {
      mockReadAvailability.mockResolvedValue(state);

      await expect(ogImageInputForSegment(ENCODED)).resolves.toBe(
        GENERIC_IMAGE,
      );
      // Not even asked: a Profile read for a Handle that is not claimed is a
      // Profile fetched for an image that must not draw it.
      expect(mockReadProfile).not.toHaveBeenCalled();
    },
  );

  it("is the generic image, with no read, for a segment that is not a Handle", async () => {
    // Not a 404: an image route that 404'd junk but drew a generic card for a
    // reserved Handle would tell the two apart.
    mockCanonicalise.mockReturnValue({
      ok: false,
      reason: "unknown-codepoint",
    });

    await expect(
      ogImageInputForSegment("ice-cube.ice-cube.ice-cube"),
    ).resolves.toBe(GENERIC_IMAGE);
    expect(mockReadAvailability).not.toHaveBeenCalled();
    expect(mockReadProfile).not.toHaveBeenCalled();
  });

  it("is the generic image, with no read, for a non-canonical spelling", async () => {
    // The metadata only ever links the canonical path, so another spelling is
    // somebody constructing URLs by hand. It gets no redirect and no Profile.
    mockCanonicalise.mockReturnValue({ ...RESOLVED, isCanonical: false });

    await expect(ogImageInputForSegment(`${ENCODED}%EF%B8%8F`)).resolves.toBe(
      GENERIC_IMAGE,
    );
    expect(mockReadAvailability).not.toHaveBeenCalled();
  });
});
