/**
 * @jest-environment node
 */

/**
 * The Profile read behind the Handle route, and — the part that matters — what
 * it refuses to read at all.
 *
 * `@template/core`'s root entry point cannot be `require`d under this suite
 * (better-auth is ESM-only), which is why `availability.test.ts` mocks it. Here
 * the mock is built from the **real** pure modules instead: `profile-state.ts`
 * and `db/handle-key.ts` import nothing but types and `canonicalise`, so they
 * load cleanly on their own. That matters for the sealed-held assertion below —
 * a hand-written stand-in for `profileStateOf` would be asserting that this
 * file's own fake composes correctly, which proves nothing about the rule the
 * domain actually enforces.
 */
import type { Profile } from "@template/core";

/**
 * The two modules are typed through the **package's** declarations rather than
 * through a `typeof import("../../../../packages/core/src/…")`, which would pull
 * `packages/core`'s source files into `apps/web`'s TypeScript program and fail
 * `tsc --noEmit` with `TS6059: … not under rootDir`. The paths in the factory
 * below are runtime strings only.
 */
type CoreProfileState = Pick<typeof import("@template/core"), "profileStateOf">;
type CoreHandleKey = Pick<typeof import("@template/core"), "toHandleKey">;

jest.mock("@template/core", () => {
  const profileState = jest.requireActual<CoreProfileState>(
    "../../../../packages/core/src/profile/profile-state",
  );
  const handleKey = jest.requireActual<CoreHandleKey>(
    "../../../../packages/core/src/db/handle-key",
  );

  return {
    profileStateOf: profileState.profileStateOf,
    toHandleKey: handleKey.toHandleKey,
  };
});

const ICE = "\u{1F9CA}";
const KEY = `${ICE}${ICE}${ICE}`;
const ENCODED = "%F0%9F%A7%8A%F0%9F%A7%8A%F0%9F%A7%8A";

/**
 * A Profile with something in every field, used as the **bait** for the states
 * that must never reach a Profile read. If the guard is removed, this is what
 * comes back.
 */
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

const profileOf = jest.fn((_key: string): Promise<Profile | undefined> =>
  Promise.resolve(PROFILE),
);
const getServices = jest.fn(() => ({ profiles: { profileOf } }));
jest.mock("./services", () => ({
  getServices: () => getServices(),
}));

import { readProfile } from "./profile";

describe("the Profile read", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    profileOf.mockResolvedValue(PROFILE);
    getServices.mockReturnValue({ profiles: { profileOf } });
  });

  it("answers with the Profile when the Handle is claimed", async () => {
    await expect(readProfile(ENCODED, "claimed")).resolves.toEqual({
      state: "profile",
      profile: PROFILE,
    });
  });

  it("asks about the canonical key the segment resolves to", async () => {
    await readProfile(ENCODED, "claimed");

    expect(profileOf).toHaveBeenCalledWith(KEY);
  });

  it("answers unedited — a named state — when a claimed Handle has no row", async () => {
    profileOf.mockResolvedValue(undefined);

    await expect(readProfile(ENCODED, "claimed")).resolves.toEqual({
      state: "unedited",
    });
  });

  it.each([
    "held",
    "available",
    "not-claimable",
    "unknown",
    "not-a-handle",
  ] as const)("never reads a Profile for a %s Handle", async (state) => {
    // ADR-0004: a held Handle reveals neither its holder nor its expiry, and
    // the cheapest way to keep a Profile out of that answer is not to fetch
    // one. `available` matters for the other reason `profileStateOf`
    // documents: a lazily-expired hold leaves its Profile row sitting there,
    // and publishing it would be a page for a Handle back in the pool.
    await expect(readProfile(ENCODED, state)).resolves.toEqual({
      state: "none",
    });
    expect(profileOf).not.toHaveBeenCalled();
    expect(getServices).not.toHaveBeenCalled();
  });

  it("shows nothing rather than an empty Profile when the read fails", async () => {
    // `unedited` would be the wrong fallback: it is a statement about the
    // owner, and a refused connection says nothing about the owner. `none`
    // leaves the route on its honest "This Handle is taken." line.
    getServices.mockImplementation(() => {
      throw new Error("DATABASE_URL is not set.");
    });
    const logged = jest
      .spyOn(console, "error")
      .mockImplementation(() => undefined);

    await expect(readProfile(ENCODED, "claimed")).resolves.toEqual({
      state: "none",
    });
    expect(logged).toHaveBeenCalledWith(
      expect.stringContaining("profile_read_failed"),
    );

    logged.mockRestore();
  });

  it("shows nothing when the segment is not a Handle at all", async () => {
    await expect(readProfile("not-a-handle", "claimed")).resolves.toEqual({
      state: "none",
    });
    expect(profileOf).not.toHaveBeenCalled();
  });
});
