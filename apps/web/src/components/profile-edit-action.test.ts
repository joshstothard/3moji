/**
 * @jest-environment node
 */

/**
 * The Profile edit, as a server action.
 *
 * **Authorisation is what this file is for.** A server action is a public HTTP
 * endpoint: it can be posted to directly, with any Handle in the body, by
 * anyone holding a session cookie. So "the form was never rendered for them" is
 * not a defence, and the case that matters is not the signed-out one — it is a
 * **signed-in visitor who owns a different Handle**, which is the shape an
 * authorisation bug actually reaches.
 *
 * The rule itself is not stubbed here. `profileEditAuthority` and
 * `toHandleKey` are pulled in from `packages/core`'s own source — both are pure
 * and reach no infrastructure — so what these tests exercise is the real
 * comparison against the real canonical key, not a fake that agrees with them.
 * Only `editProfile` and `canonicalise` are stubbed, and only because the root
 * entry point cannot be `require`d under this suite.
 */
import type { ProfileDraft } from "@template/core";
import type { OwnedHandle } from "@template/core";

const ICE = "\u{1F9CA}\u{1F9CA}\u{1F9CA}";
const ICE_ENCODED = "%F0%9F%A7%8A%F0%9F%A7%8A%F0%9F%A7%8A";
const BALLOON = "\u{1F388}\u{1F388}\u{1F388}";

/**
 * The real modules are typed through the **package's** declarations rather than
 * through a `typeof import("../../../../packages/core/src/…")`, which would
 * pull `packages/core`'s source into `apps/web`'s TypeScript program and fail
 * `tsc --noEmit` with `TS6059: … not under rootDir`. The paths below are
 * runtime strings only — the same device `lib/profile.test.ts` uses.
 */
const realAuthority = jest.requireActual<
  Pick<typeof import("@template/core"), "profileEditAuthority">
>("../../../../packages/core/src/profile/profile-authority");
const realHandleKey = jest.requireActual<
  Pick<typeof import("@template/core"), "toHandleKey">
>("../../../../packages/core/src/db/handle-key");
const realCanonicalise = jest.requireActual<
  Pick<typeof import("@template/core"), "canonicalise">
>("../../../../packages/core/src/handle/canonicalise");

type EditResult =
  | { readonly state: "saved" }
  | { readonly state: "invalid"; readonly violations: readonly unknown[] };

interface EditInput {
  readonly userId: string;
  readonly draft: ProfileDraft;
  readonly store: unknown;
  readonly clock: unknown;
}

const editProfile = jest.fn((_input: EditInput): Promise<EditResult> =>
  Promise.resolve({ state: "saved" }),
);

jest.mock("@template/core", () => ({
  canonicalise: realCanonicalise.canonicalise,
  toHandleKey: realHandleKey.toHandleKey,
  profileEditAuthority: realAuthority.profileEditAuthority,
  editProfile: (input: EditInput) => editProfile(input),
}));

/** Who the session says is asking. `undefined` is signed out. */
let viewer: { readonly userId: string } | undefined = {
  userId: "owner-of-ice",
};
jest.mock("../lib/session", () => ({
  readViewer: () => Promise.resolve(viewer),
}));

/** What the directory says that Account owns. */
let owned: OwnedHandle | undefined;
const handleOf = jest.fn((_userId: string) => Promise.resolve(owned));
const PROFILE_EDITS = { runInTransaction: jest.fn() };
jest.mock("../lib/services", () => ({
  getServices: () => ({
    accounts: { byEmail: jest.fn(), handleOf },
    profiles: { profileOf: jest.fn() },
    profileEdits: PROFILE_EDITS,
    clock: { now: () => new Date(0) },
  }),
}));

/**
 * One log for both, because **the order is the behaviour**.
 * `docs/development/engineering-standards.md` § Frontend: without
 * `revalidatePath` first, Next serves the cached page and the edit appears not
 * to have taken effect. Two separate "was it called?" assertions are satisfied
 * in either order, which is precisely the defect they would be written to
 * catch.
 */
const calls: string[] = [];
jest.mock("next/cache", () => ({
  revalidatePath: (path: string): undefined => {
    calls.push(`revalidatePath:${path}`);
  },
}));
jest.mock("next/navigation", () => ({
  redirect: (url: string): undefined => {
    calls.push(`redirect:${url}`);
  },
}));

import { saveProfileAction } from "./profile-edit-action";

const claimed = (handle: string): OwnedHandle => {
  const key = realHandleKey.toHandleKey(handle);
  if (key === undefined) throw new Error("the test Handle must canonicalise");
  return {
    key,
    heldUntil: new Date("2026-09-14T00:00:00.000Z"),
    claimedAt: new Date("2026-09-01T00:00:00.000Z"),
  };
};

const form = (fields: Readonly<Record<string, string>>): FormData => {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
};

const IDLE = { state: "idle" } as const;

const FILLED = {
  handle: ICE,
  displayName: "Ice Cube",
  bio: "Three of them.",
  "link-0-title": "Home",
  "link-0-url": "https://example.com",
};

beforeEach(() => {
  calls.length = 0;
  editProfile.mockClear();
  handleOf.mockClear();
  editProfile.mockResolvedValue({ state: "saved" });
  viewer = { userId: "owner-of-ice" };
  owned = claimed(ICE);
});

describe("saveProfileAction, for the owner", () => {
  it("writes the Profile under the id the session resolved to", async () => {
    await saveProfileAction(IDLE, form(FILLED));

    expect(editProfile).toHaveBeenCalledTimes(1);
    const input = editProfile.mock.calls[0]?.[0];
    expect(input?.userId).toBe("owner-of-ice");
    expect(input?.draft).toEqual({
      displayName: "Ice Cube",
      bio: "Three of them.",
      links: [{ title: "Home", url: "https://example.com" }],
    });
    expect(input?.store).toBe(PROFILE_EDITS);
  });

  /**
   * **The ordering criterion**, asserted as an order rather than as two facts.
   */
  it("revalidates the Handle's page before redirecting to it", async () => {
    await saveProfileAction(IDLE, form(FILLED));

    expect(calls).toEqual([
      `revalidatePath:/${ICE_ENCODED}`,
      `redirect:/${ICE_ENCODED}`,
    ]);
  });

  /**
   * The percent-encoded segment, never the raw key: a raw emoji in a
   * `Location` header fails Node's header validation with `ERR_INVALID_CHAR`
   * and serves a 500.
   */
  it("uses the percent-encoded segment for both", async () => {
    await saveProfileAction(IDLE, form(FILLED));

    expect(calls).toHaveLength(2);
    expect(calls.every((call) => !call.includes("\u{1F9CA}"))).toBe(true);
  });

  it("keeps the Links in the order they were posted", async () => {
    await saveProfileAction(
      IDLE,
      form({
        handle: ICE,
        displayName: "",
        bio: "",
        "link-0-title": "First",
        "link-0-url": "https://a.example",
        "link-1-title": "Second",
        "link-1-url": "https://b.example",
      }),
    );

    expect(editProfile.mock.calls[0]?.[0].draft.links).toEqual([
      { title: "First", url: "https://a.example" },
      { title: "Second", url: "https://b.example" },
    ]);
  });

  /**
   * Ten rows sort numerically, not lexically: `"10"` precedes `"2"` as a
   * string, which would silently put the tenth Link second — an ordering bug
   * nobody would see until they added their tenth Link.
   */
  it("orders rows numerically, so the tenth Link is not the second", async () => {
    const fields: Record<string, string> = { handle: ICE };
    for (let index = 0; index < 11; index += 1) {
      fields[`link-${String(index)}-title`] = `Link ${String(index)}`;
      fields[`link-${String(index)}-url`] = `https://${String(index)}.example`;
    }

    await saveProfileAction(IDLE, form(fields));

    expect(
      editProfile.mock.calls[0]?.[0].draft.links.map((link) => link.title),
    ).toEqual([
      "Link 0",
      "Link 1",
      "Link 2",
      "Link 3",
      "Link 4",
      "Link 5",
      "Link 6",
      "Link 7",
      "Link 8",
      "Link 9",
      "Link 10",
    ]);
  });

  /**
   * An eleventh row is **passed to the domain**, not trimmed away here. The
   * limit is `validateProfile`'s to state, and a transport that dropped the
   * extra row would turn "you have too many links" into a Link that silently
   * vanished.
   */
  it("hands an over-long list to the domain rather than truncating it", async () => {
    const fields: Record<string, string> = { handle: ICE };
    for (let index = 0; index < 11; index += 1) {
      fields[`link-${String(index)}-title`] = "Link";
      fields[`link-${String(index)}-url`] = "https://example.com";
    }

    await saveProfileAction(IDLE, form(fields));

    expect(editProfile.mock.calls[0]?.[0].draft.links).toHaveLength(11);
  });

  /** Clearing both halves of a row is how the form removes a Link. */
  it("drops a row the owner emptied, and keeps one with only a title", async () => {
    await saveProfileAction(
      IDLE,
      form({
        handle: ICE,
        "link-0-title": "",
        "link-0-url": "",
        "link-1-title": "Kept",
        "link-1-url": "",
      }),
    );

    expect(editProfile.mock.calls[0]?.[0].draft.links).toEqual([
      { title: "Kept", url: "" },
    ]);
  });
});

describe("saveProfileAction, when the domain rejects the draft", () => {
  it("returns every violation with the draft, and does not redirect", async () => {
    const violations = [
      { field: "bio", rule: "too-long", limit: 160, length: 161 },
    ];
    editProfile.mockResolvedValue({ state: "invalid", violations });

    const state = await saveProfileAction(IDLE, form(FILLED));

    expect(state).toEqual({
      state: "invalid",
      violations,
      draft: {
        displayName: "Ice Cube",
        bio: "Three of them.",
        links: [{ title: "Home", url: "https://example.com" }],
      },
    });
    expect(calls).toEqual([]);
  });

  it("hands the draft back when the write itself fails", async () => {
    editProfile.mockRejectedValue(new Error("connection refused"));
    jest.spyOn(console, "error").mockImplementation(() => undefined);

    const state = await saveProfileAction(IDLE, form(FILLED));

    expect(state).toEqual({
      state: "failed",
      draft: {
        displayName: "Ice Cube",
        bio: "Three of them.",
        links: [{ title: "Home", url: "https://example.com" }],
      },
    });
    expect(calls).toEqual([]);
    jest.restoreAllMocks();
  });
});

/**
 * **Every refusal is proved by what was not written**, not only by what was
 * returned. A `forbidden` answer from an action that had already saved would
 * satisfy a state-only assertion.
 */
describe("saveProfileAction refuses anyone but the owner", () => {
  const refused = async (handle: string) => {
    const state = await saveProfileAction(IDLE, form({ ...FILLED, handle }));
    return {
      state,
      wrote: editProfile.mock.calls.length,
      navigated: [...calls],
    };
  };

  it("refuses a signed-out visitor", async () => {
    viewer = undefined;
    owned = undefined;

    expect(await refused(ICE)).toEqual({
      state: { state: "forbidden" },
      wrote: 0,
      navigated: [],
    });
  });

  /**
   * **The case that matters.** Signed in, a live Account, a Handle of their
   * own — and posting somebody else's Handle to the endpoint directly. Nothing
   * but the comparison against the session's own Handle stops this, and
   * `profile.user_id` being the primary key means an unguarded write would
   * quietly rewrite *their own* Profile instead of refusing.
   */
  it("refuses a signed-in visitor who owns a different Handle", async () => {
    viewer = { userId: "owner-of-balloons" };
    owned = claimed(BALLOON);

    expect(await refused(ICE)).toEqual({
      state: { state: "forbidden" },
      wrote: 0,
      navigated: [],
    });
    // The session was consulted about its own Account, never about the posted
    // Handle: the id under which anything might be written comes from the
    // session alone.
    expect(handleOf).toHaveBeenCalledWith("owner-of-balloons");
  });

  it("refuses a signed-in visitor whose Account owns no Handle", async () => {
    viewer = { userId: "handle-less" };
    owned = undefined;

    expect(await refused(ICE)).toEqual({
      state: { state: "forbidden" },
      wrote: 0,
      navigated: [],
    });
  });

  /** A hold is not ownership: `claimed_at` is what ownership means. */
  it("refuses a holder whose Claim is not yet final", async () => {
    const held = claimed(ICE);
    owned = { key: held.key, heldUntil: held.heldUntil, claimedAt: null };

    expect(await refused(ICE)).toEqual({
      state: { state: "forbidden" },
      wrote: 0,
      navigated: [],
    });
  });

  it("refuses a posted Handle that is not a Handle at all", async () => {
    expect(await refused("not-emoji")).toEqual({
      state: { state: "forbidden" },
      wrote: 0,
      navigated: [],
    });
  });

  it("refuses a post with no Handle field at all", async () => {
    const state = await saveProfileAction(IDLE, form({ displayName: "x" }));

    expect(state).toEqual({ state: "forbidden" });
    expect(editProfile).not.toHaveBeenCalled();
    expect(calls).toEqual([]);
  });

  /**
   * The refusals are **one answer**. Four distinguishable ones would tell a
   * stranger which of them applies to a Handle that is not theirs.
   */
  it("says the same thing to all of them", async () => {
    viewer = undefined;
    const signedOut = await saveProfileAction(IDLE, form(FILLED));
    viewer = { userId: "owner-of-balloons" };
    owned = claimed(BALLOON);
    const wrongHandle = await saveProfileAction(IDLE, form(FILLED));

    expect(signedOut).toEqual(wrongHandle);
  });
});
