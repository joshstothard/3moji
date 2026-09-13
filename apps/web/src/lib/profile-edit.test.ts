/**
 * @jest-environment node
 */

/**
 * The transport-side composition of the Profile edit rule, and — the part that
 * matters — what it refuses when it cannot establish anything.
 *
 * The rule itself is **not** stubbed: `profile-authority.ts` and
 * `db/handle-key.ts` import nothing but types and `canonicalise`, so they load
 * cleanly on their own and the real comparison runs here. A hand-written
 * stand-in would be asserting that this file's own fake agrees with itself.
 * `lib/profile.test.ts` mocks `@template/core` the same way and for the same
 * reason.
 */
import type { OwnedHandle, ProfileEditAuthority } from "@template/core";

type CoreAuthority = Pick<
  typeof import("@template/core"),
  "profileEditAuthority"
>;
type CoreHandleKey = Pick<typeof import("@template/core"), "toHandleKey">;

jest.mock("@template/core", () => {
  const authority = jest.requireActual<CoreAuthority>(
    "../../../../packages/core/src/profile/profile-authority",
  );
  const handleKey = jest.requireActual<CoreHandleKey>(
    "../../../../packages/core/src/db/handle-key",
  );
  return {
    profileEditAuthority: authority.profileEditAuthority,
    toHandleKey: handleKey.toHandleKey,
  };
});

const ICE = "\u{1F9CA}";
const KEY = `${ICE}${ICE}${ICE}`;
const BALLOON_KEY = "\u{1F388}\u{1F388}\u{1F388}";

let viewer: { readonly userId: string } | undefined;
const readViewer = jest.fn(() => Promise.resolve(viewer));
jest.mock("./session", () => ({ readViewer: () => readViewer() }));

const handleOf = jest.fn((_userId: string): Promise<OwnedHandle | undefined> =>
  Promise.resolve(undefined),
);
const profileOf = jest.fn();
let services: () => { accounts: unknown; profiles: unknown } = () => ({
  accounts: { byEmail: jest.fn(), handleOf },
  profiles: { profileOf },
});
jest.mock("./services", () => ({ getServices: () => services() }));

import { readEditableDraft, readEditAuthority } from "./profile-edit";

const owned = (key: string, claimed = true): OwnedHandle => {
  const handleKey = jest
    .requireActual<CoreHandleKey>("../../../../packages/core/src/db/handle-key")
    .toHandleKey(key);
  if (handleKey === undefined)
    throw new Error("the test Handle must canonicalise");
  return {
    key: handleKey,
    heldUntil: new Date("2026-09-14T00:00:00.000Z"),
    claimedAt: claimed ? new Date("2026-09-01T00:00:00.000Z") : null,
  };
};

const workingServices = () => ({
  accounts: { byEmail: jest.fn(), handleOf },
  profiles: { profileOf },
});

beforeEach(() => {
  jest.spyOn(console, "error").mockImplementation(() => undefined);
  viewer = { userId: "owner" };
  services = workingServices;
  handleOf.mockResolvedValue(owned(KEY));
  profileOf.mockResolvedValue(undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("readEditAuthority", () => {
  const answer = (key = KEY): Promise<ProfileEditAuthority> =>
    readEditAuthority(key);

  it("allows the owner of the claimed Handle", async () => {
    expect(await answer()).toEqual({ state: "allowed", userId: "owner" });
  });

  it("refuses a signed-out visitor without asking the directory anything", async () => {
    viewer = undefined;
    handleOf.mockClear();

    expect(await answer()).toEqual({ state: "signed-out" });
    expect(handleOf).not.toHaveBeenCalled();
  });

  it("refuses a signed-in visitor who owns a different Handle", async () => {
    handleOf.mockResolvedValue(owned(BALLOON_KEY));

    expect(await answer()).toEqual({ state: "not-owner" });
  });

  it("asks the directory about the session's own id, never about the Handle", async () => {
    viewer = { userId: "someone-else" };
    handleOf.mockResolvedValue(owned(BALLOON_KEY));

    await answer();

    expect(handleOf).toHaveBeenCalledWith("someone-else");
  });

  /**
   * **A read that failed is a refusal, not an error.** `getServices()` throws
   * on a machine without the five environment variables, and "we could not
   * check" must never open an edit form — the one direction in which failing
   * open is an authorisation bypass.
   */
  it("refuses when the directory cannot be reached", async () => {
    handleOf.mockRejectedValue(new Error("connect ECONNREFUSED"));

    expect(await answer()).toEqual({ state: "no-handle" });
  });

  it("refuses when the services cannot be built at all", async () => {
    services = () => {
      throw new Error("DATABASE_URL is not set");
    };

    expect(await answer()).toEqual({ state: "no-handle" });
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
      handleOf.mockRejectedValue(new Error(message));
      await answer();
      const output = JSON.stringify(logged.mock.calls);
      expect(output).toContain("edit_authority_read_failed");
      expect(output).not.toContain(secret);
      logged.mockRestore();
    },
  );

  it("refuses a segment that is not a Handle", async () => {
    expect(await answer("not-emoji")).toEqual({ state: "not-owner" });
  });
});

describe("readEditableDraft", () => {
  it("opens on the Profile as it stands, with nulls as blanks", async () => {
    profileOf.mockResolvedValue({
      displayName: null,
      bio: "Three of them.",
      links: [
        { id: "l1", title: "Home", url: "https://example.com", position: 0 },
      ],
      updatedAt: new Date(0),
    });

    expect(await readEditableDraft(KEY)).toEqual({
      displayName: "",
      bio: "Three of them.",
      links: [{ title: "Home", url: "https://example.com" }],
    });
  });

  it("opens blank for an owner who has never edited anything", async () => {
    profileOf.mockResolvedValue(undefined);

    expect(await readEditableDraft(KEY)).toEqual({
      displayName: "",
      bio: "",
      links: [],
    });
  });

  /**
   * **A failed read is not an empty Profile.** Answering with blanks here
   * invites the owner to save them over content that is still there, and the
   * write replaces the whole Link list — so this is the one failure on the path
   * that destroys somebody's Profile rather than merely frustrating them.
   */
  it("answers undefined when the Profile could not be read", async () => {
    profileOf.mockRejectedValue(new Error("connect ECONNREFUSED"));

    expect(await readEditableDraft(KEY)).toBeUndefined();
  });

  it("answers undefined when the services cannot be built", async () => {
    services = () => {
      throw new Error("DATABASE_URL is not set");
    };

    expect(await readEditableDraft(KEY)).toBeUndefined();
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
      await readEditableDraft(KEY);
      const output = JSON.stringify(logged.mock.calls);
      expect(output).toContain("editable_profile_read_failed");
      expect(output).not.toContain(secret);
      logged.mockRestore();
    },
  );

  it("answers undefined for a segment that is not a Handle", async () => {
    expect(await readEditableDraft("not-emoji")).toBeUndefined();
  });
});
