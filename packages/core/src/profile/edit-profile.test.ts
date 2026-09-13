import type { Clock } from "../ports/clock";
import type {
  ProfileStore,
  ProfileToWrite,
  ProfileTransaction,
} from "../ports/profile-store";
import { editProfile } from "./edit-profile";
import {
  BIO_MAX_LENGTH,
  DISPLAY_NAME_MAX_LENGTH,
  type ProfileDraft,
} from "./validate-profile";

const NOW = new Date("2026-09-13T09:30:00.000Z");
const clock: Clock = { now: () => NOW };
const USER = "owner-of-ice";

/**
 * A {@link ProfileStore} that records what the edit did, **in order**, and
 * mirrors the real adapter's contract: `commit: false` rolls back.
 *
 * The call log is what the assertions rest on. A returned `saved` cannot tell
 * an edit that wrote from one that did not — which is the vacuity the release
 * suite found in its own predicate — and a rejected edit must be provable to
 * have opened no transaction at all.
 */
function createFakeStore() {
  const calls: string[] = [];
  const written: ProfileToWrite[] = [];

  const store: ProfileStore = {
    async runInTransaction(work) {
      calls.push("begin");
      const tx: ProfileTransaction = {
        async saveProfile(input) {
          calls.push("saveProfile");
          written.push(input);
          return Promise.resolve();
        },
      };
      const outcome = await work(tx);
      calls.push(outcome.commit ? "commit" : "rollback");
      return outcome.value;
    },
  };

  return { store, calls, written };
}

const draft = (overrides: Partial<ProfileDraft> = {}): ProfileDraft => ({
  displayName: "Ice Cube",
  bio: "Three of them.",
  links: [{ title: "Home", url: "https://example.com" }],
  ...overrides,
});

describe("editProfile", () => {
  it("writes the whole Profile and commits", async () => {
    const { store, calls, written } = createFakeStore();

    const result = await editProfile({
      userId: USER,
      draft: draft(),
      store,
      clock,
    });

    expect(result).toEqual({ state: "saved" });
    expect(calls).toEqual(["begin", "saveProfile", "commit"]);
    expect(written).toEqual([
      {
        userId: USER,
        displayName: "Ice Cube",
        bio: "Three of them.",
        links: [{ title: "Home", url: "https://example.com" }],
        updatedAt: NOW,
      },
    ]);
  });

  it("stamps `updated_at` from the injected Clock, never from the system", async () => {
    const { store, written } = createFakeStore();

    await editProfile({ userId: USER, draft: draft(), store, clock });

    expect(written[0]?.updatedAt).toEqual(NOW);
  });

  /**
   * The limits are `validateProfile`'s and are not restated here — this asserts
   * that the write path **consults** them and that a rejection names the field
   * and the rule, which is what a form has to render.
   */
  it("rejects a draft that breaks a limit, naming every field and rule", async () => {
    const { store } = createFakeStore();

    const result = await editProfile({
      userId: USER,
      draft: draft({
        displayName: "x".repeat(DISPLAY_NAME_MAX_LENGTH + 1),
        bio: "y".repeat(BIO_MAX_LENGTH + 1),
        links: [{ title: "Bad", url: "javascript:alert(1)" }],
      }),
      store,
      clock,
    });

    expect(result).toEqual({
      state: "invalid",
      violations: [
        {
          field: "displayName",
          rule: "too-long",
          limit: DISPLAY_NAME_MAX_LENGTH,
          length: DISPLAY_NAME_MAX_LENGTH + 1,
        },
        {
          field: "bio",
          rule: "too-long",
          limit: BIO_MAX_LENGTH,
          length: BIO_MAX_LENGTH + 1,
        },
        {
          field: "link.url",
          index: 0,
          rule: "unsupported-scheme",
          scheme: "javascript:",
        },
      ],
    });
  });

  /**
   * **A rejected edit opens no transaction.** Returning `invalid` while having
   * already written is the failure this asserts against, and a result-only
   * assertion cannot see it.
   */
  it("writes nothing at all when the draft is rejected", async () => {
    const { store, calls, written } = createFakeStore();

    await editProfile({
      userId: USER,
      draft: draft({ displayName: "x".repeat(DISPLAY_NAME_MAX_LENGTH + 1) }),
      store,
      clock,
    });

    expect(calls).toEqual([]);
    expect(written).toEqual([]);
  });

  /**
   * `NULL` is the column's "never set" (`src/db/profile.ts`), and the page
   * renders on `displayName !== null`. An empty string would therefore publish
   * an empty heading rather than no heading — the same value, two different
   * pages — so a blank collapses here, in the one place that writes.
   *
   * **Blank is still permitted.** `validateProfile` sets maxima only; nothing
   * requires a display name, and this does not invent a rule that does.
   */
  it("stores a blank display name and bio as NULL, not as an empty string", async () => {
    const { store, written } = createFakeStore();

    const result = await editProfile({
      userId: USER,
      draft: draft({ displayName: "   ", bio: "" }),
      store,
      clock,
    });

    expect(result).toEqual({ state: "saved" });
    expect(written[0]?.displayName).toBeNull();
    expect(written[0]?.bio).toBeNull();
  });

  it("keeps the Link order the owner submitted", async () => {
    const { store, written } = createFakeStore();

    await editProfile({
      userId: USER,
      draft: draft({
        links: [
          { title: "Second", url: "https://b.example" },
          { title: "First", url: "https://a.example" },
        ],
      }),
      store,
      clock,
    });

    expect(written[0]?.links).toEqual([
      { title: "Second", url: "https://b.example" },
      { title: "First", url: "https://a.example" },
    ]);
  });

  it("saves a Profile with no Links at all", async () => {
    const { store, written } = createFakeStore();

    const result = await editProfile({
      userId: USER,
      draft: draft({ links: [] }),
      store,
      clock,
    });

    expect(result).toEqual({ state: "saved" });
    expect(written[0]?.links).toEqual([]);
  });
});
