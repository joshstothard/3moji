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
const displayNamesOf = jest.fn(
  (_keys: readonly string[]): Promise<ReadonlyMap<string, string>> =>
    Promise.resolve(new Map()),
);
const getServices = jest.fn(() => ({
  profiles: { profileOf, displayNamesOf },
}));
jest.mock("./services", () => ({
  getServices: () => getServices(),
}));

import { readDisplayNames, readProfile } from "./profile";

describe("the Profile read", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    profileOf.mockResolvedValue(PROFILE);
    getServices.mockReturnValue({ profiles: { profileOf, displayNamesOf } });
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

  it.each([
    [
      "an email address",
      `Key (email)=(someone@example.com) already exists.`,
      "someone@example.com",
    ],
    [
      "a password",
      `password authentication failed: "hunter2-Tr0ub4dor&3"`,
      "hunter2-Tr0ub4dor&3",
    ],
  ])(
    "keeps %s in the error's message out of the log line (#134)",
    async (_what, message, secret) => {
      const logged = jest
        .spyOn(console, "error")
        .mockImplementation(() => undefined);
      profileOf.mockRejectedValue(new Error(message));
      await readProfile(ENCODED, "claimed");
      const output = JSON.stringify(logged.mock.calls);
      expect(output).toContain("profile_read_failed");
      expect(output).not.toContain(secret);
      logged.mockRestore();
    },
  );

  it("shows nothing when the segment is not a Handle at all", async () => {
    await expect(readProfile("not-a-handle", "claimed")).resolves.toEqual({
      state: "none",
    });
    expect(profileOf).not.toHaveBeenCalled();
  });
});

/**
 * The listing's read: every display name behind a set of Handles, in one call
 * ([#109](https://github.com/joshstothard/3moji/issues/109)).
 *
 * **It exists for the bound, not for convenience.** An alias costs one
 * availability read per candidate — ADR-0008's worst measured alias is 64 —
 * and a `readProfile` per row would double that to fetch a bio and a Link list
 * the listing never shows. One batched read keeps the page at N + 1.
 *
 * It answers a map keyed on the **percent-encoded segment** the caller asked
 * about, so the route never handles a branded key and the two reads behind a
 * row cannot be about different Handles. An absent key is the one state for
 * "no name to show", covering a claimed Handle with no Profile row and one
 * whose `display_name` was never set.
 */
describe("the display-name read behind a listing", () => {
  const OCTOPUS = "\u{1F419}";
  const OCTOPUS_KEY = `${OCTOPUS}${OCTOPUS}${OCTOPUS}`;
  const OCTOPUS_ENCODED = encodeURIComponent(OCTOPUS_KEY);

  beforeEach(() => {
    jest.clearAllMocks();
    getServices.mockReturnValue({ profiles: { profileOf, displayNamesOf } });
    displayNamesOf.mockResolvedValue(
      new Map([
        [KEY, "Zoe Frost"],
        [OCTOPUS_KEY, "Otto Pus"],
      ]),
    );
  });

  it("asks about every segment's canonical key in one call", async () => {
    await readDisplayNames([ENCODED, OCTOPUS_ENCODED]);

    expect(displayNamesOf).toHaveBeenCalledTimes(1);
    expect(displayNamesOf).toHaveBeenCalledWith([KEY, OCTOPUS_KEY]);
  });

  it("answers keyed on the segment it was asked about, not on the key", async () => {
    // The route holds percent-encoded segments and nothing else; handing it a
    // map keyed on a branded `HandleKey` would make every lookup a second
    // canonicalisation at the render.
    await expect(readDisplayNames([ENCODED, OCTOPUS_ENCODED])).resolves.toEqual(
      new Map([
        [ENCODED, "Zoe Frost"],
        [OCTOPUS_ENCODED, "Otto Pus"],
      ]),
    );
  });

  it("omits a Handle the query answered nothing for", async () => {
    // A claimed Handle whose owner has never edited anything has no row, and a
    // row with a null `display_name` has no name: both are absence, and one
    // absence is one branch at the render instead of three.
    displayNamesOf.mockResolvedValue(new Map([[KEY, "Zoe Frost"]]));

    const names = await readDisplayNames([ENCODED, OCTOPUS_ENCODED]);

    expect(names.has(OCTOPUS_ENCODED)).toBe(false);
    expect(names.get(ENCODED)).toBe("Zoe Frost");
  });

  it("issues no query at all when there is nothing to ask about", async () => {
    // An empty `IN ()` is a round trip that cannot return a row, and Drizzle's
    // `inArray` is a sharp edge on an empty list.
    await expect(readDisplayNames([])).resolves.toEqual(new Map());

    expect(getServices).not.toHaveBeenCalled();
    expect(displayNamesOf).not.toHaveBeenCalled();
  });

  it("skips a segment that is not a Handle rather than failing the page", async () => {
    await readDisplayNames(["not-a-handle", ENCODED]);

    expect(displayNamesOf).toHaveBeenCalledWith([KEY]);
  });

  it.each([
    [
      "an email address",
      `Key (email)=(someone@example.com) already exists.`,
      "someone@example.com",
    ],
    [
      "a password",
      `password authentication failed: "hunter2-Tr0ub4dor&3"`,
      "hunter2-Tr0ub4dor&3",
    ],
  ])(
    "keeps %s in the error's message out of the log line (#134)",
    async (_what, message, secret) => {
      const logged = jest
        .spyOn(console, "error")
        .mockImplementation(() => undefined);
      displayNamesOf.mockRejectedValue(new Error(message));
      await readDisplayNames([ENCODED]);
      const output = JSON.stringify(logged.mock.calls);
      expect(output).toContain("display_names_read_failed");
      expect(output).not.toContain(secret);
      logged.mockRestore();
    },
  );

  it("degrades to no names rather than throwing when the read fails", async () => {
    // The names decorate the rows; the emoji are the identity. A refused
    // connection must cost the listing its names, never the whole page.
    getServices.mockImplementation(() => {
      throw new Error("DATABASE_URL is not set.");
    });
    const logged = jest
      .spyOn(console, "error")
      .mockImplementation(() => undefined);

    await expect(readDisplayNames([ENCODED])).resolves.toEqual(new Map());
    expect(logged).toHaveBeenCalledWith(
      expect.stringContaining("display_names_read_failed"),
    );

    logged.mockRestore();
  });
});
