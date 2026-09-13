/**
 * @jest-environment node
 */

/**
 * Account deletion, as a server action
 * ([#195](https://github.com/joshstothard/3moji/issues/195)).
 *
 * **Authorisation is what this file is for.** A server action is a public HTTP
 * endpoint that can be posted to directly with any fields, so the cases that
 * matter are a request with no session, a request whose form names somebody
 * else's Account, and a request that skipped the confirmation. Each must
 * delete nothing.
 *
 * `releaseHandle` is stubbed — its transaction is proved against Postgres in
 * `packages/core/src/handle/release.integration.test.ts` and end to end in
 * `e2e/account-deletion.spec.ts`. `canonicalise` is the real one, so the path
 * revalidated is the one a real key produces.
 */
import en from "../../../../packages/shared/messages/en.json";

const copy = en.AccountPage;

const ICE = "\u{1F9CA}\u{1F9CA}\u{1F9CA}";
const ICE_ENCODED = "%F0%9F%A7%8A%F0%9F%A7%8A%F0%9F%A7%8A";
const SESSION_USER = "session-user";
const SOMEONE_ELSE = "someone-else";

const realCanonicalise = jest.requireActual<
  Pick<typeof import("@template/core"), "canonicalise">
>("../../../../packages/core/src/handle/canonicalise");

type ReleaseResult =
  | {
      readonly state: "released";
      readonly key: string;
      readonly releasedAt: Date;
    }
  | { readonly state: "no-handle" };

interface ReleaseInput {
  readonly userId: string;
  readonly store: unknown;
  readonly clock: unknown;
}

/** One log for every side effect, because **the order is the behaviour**. */
const calls: string[] = [];

const releaseHandle = jest.fn((input: ReleaseInput): Promise<ReleaseResult> => {
  calls.push(`releaseHandle:${input.userId}`);
  return Promise.resolve({
    state: "released",
    key: ICE,
    releasedAt: new Date(0),
  });
});

jest.mock("@template/core", () => ({
  canonicalise: realCanonicalise.canonicalise,
  releaseHandle: (input: ReleaseInput) => releaseHandle(input),
}));

/** Who the session says is asking. `undefined` is signed out. */
let viewer: { readonly userId: string } | undefined;
jest.mock("../lib/session", () => ({
  readViewer: () => Promise.resolve(viewer),
}));

const RELEASES = { runInTransaction: jest.fn() };
const CLOCK = { now: () => new Date(0) };
const signOut = jest.fn((_input: { readonly headers: Headers }) => {
  calls.push("signOut");
  return Promise.resolve({ success: true });
});
jest.mock("../lib/services", () => ({
  getServices: () => ({
    releases: RELEASES,
    clock: CLOCK,
    auth: { api: { signOut } },
  }),
}));

const logFailure = jest.fn();
jest.mock("../lib/log-error", () => ({
  logFailure: (event: string, error: unknown): void => {
    logFailure(event, error);
  },
}));

jest.mock("next/headers", () => ({
  headers: () => Promise.resolve(new Headers({ cookie: "session=abc" })),
}));
jest.mock("next/cache", () => ({
  revalidatePath: (path: string): undefined => {
    calls.push(`revalidatePath:${path}`);
  },
}));

/**
 * Real Next.js `redirect` throws, and the throw is what makes each refusal an
 * early exit. A mock that returned would let execution fall through a refusal
 * into the deletion — the opposite of what these tests claim to prove.
 */
class Redirected extends Error {
  constructor(readonly url: string) {
    super(`redirected to ${url}`);
  }
}
jest.mock("next/navigation", () => ({
  redirect: (url: string): never => {
    calls.push(`redirect:${url}`);
    throw new Redirected(url);
  },
}));

import { deleteAccountAction } from "./account-delete-action";

const form = (fields: Readonly<Record<string, string>>): FormData => {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
};

const CONFIRMED = { confirmation: copy.confirmWord };

/** Runs the action and answers where it redirected to, or `undefined`. */
async function run(data: FormData): Promise<string | undefined> {
  try {
    await deleteAccountAction(data);
    return undefined;
  } catch (error) {
    if (error instanceof Redirected) return error.url;
    throw error;
  }
}

beforeEach(() => {
  calls.length = 0;
  viewer = { userId: SESSION_USER };
  releaseHandle.mockClear();
  signOut.mockClear();
  logFailure.mockClear();
  jest.spyOn(console, "log").mockImplementation(() => undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("deleteAccountAction, for a confirmed owner", () => {
  it("releases the session's own Account, through the composition root's store and clock", async () => {
    await run(form(CONFIRMED));

    expect(releaseHandle).toHaveBeenCalledTimes(1);
    expect(releaseHandle).toHaveBeenCalledWith({
      userId: SESSION_USER,
      store: RELEASES,
      clock: CLOCK,
    });
  });

  it("revalidates the Profile's percent-encoded path, signs the browser out, then lands on / — in that order", async () => {
    const landed = await run(form(CONFIRMED));

    expect(landed).toBe("/");
    expect(calls).toEqual([
      `releaseHandle:${SESSION_USER}`,
      `revalidatePath:/${ICE_ENCODED}`,
      "signOut",
      "redirect:/",
    ]);
  });

  it("accepts the word with stray spaces or capitals, as a phone keyboard types it", async () => {
    await run(form({ confirmation: `  ${copy.confirmWord.toUpperCase()} ` }));

    expect(releaseHandle).toHaveBeenCalledTimes(1);
  });

  it("still lands on / signed out when clearing the cookie fails, because the Account is already gone", async () => {
    const error = new Error("sign-out refused");
    signOut.mockRejectedValueOnce(error);

    const landed = await run(form(CONFIRMED));

    expect(landed).toBe("/");
    expect(logFailure).toHaveBeenCalledWith(
      "account_delete_sign_out_failed",
      error,
    );
  });
});

describe("deleteAccountAction deletes nothing for anyone else", () => {
  it("refuses a signed-out request and sends it to sign in", async () => {
    viewer = undefined;

    const landed = await run(form({ ...CONFIRMED, userId: SOMEONE_ELSE }));

    expect(landed).toBe("/sign-in");
    expect(releaseHandle).not.toHaveBeenCalled();
    expect(signOut).not.toHaveBeenCalled();
    expect(calls).toEqual(["redirect:/sign-in"]);
  });

  it("ignores every field that names another Account, and deletes only the session's", async () => {
    await run(
      form({
        ...CONFIRMED,
        userId: SOMEONE_ELSE,
        user_id: SOMEONE_ELSE,
        id: SOMEONE_ELSE,
        handle: ICE,
      }),
    );

    expect(releaseHandle).toHaveBeenCalledTimes(1);
    expect(releaseHandle.mock.calls[0]?.[0].userId).toBe(SESSION_USER);
  });
});

describe("deleteAccountAction needs the confirmation", () => {
  it.each([
    ["no confirmation field at all", {}],
    ["an empty confirmation", { confirmation: "" }],
    ["the wrong word", { confirmation: "yes" }],
    [
      "the word inside a longer answer",
      { confirmation: `${copy.confirmWord} it` },
    ],
  ])("deletes nothing for %s", async (_label, fields) => {
    const landed = await run(form(fields));

    expect(landed).toBe("/account?error=confirm");
    expect(releaseHandle).not.toHaveBeenCalled();
    expect(signOut).not.toHaveBeenCalled();
  });
});

describe("deleteAccountAction when the Release does not happen", () => {
  it("logs a failed Release through logFailure only, and changes nothing else", async () => {
    const error = new Error("connection refused");
    releaseHandle.mockRejectedValueOnce(error);

    const landed = await run(form(CONFIRMED));

    expect(landed).toBe("/account?error=failed");
    expect(logFailure).toHaveBeenCalledWith("account_delete_failed", error);
    expect(calls).toEqual(["redirect:/account?error=failed"]);
  });

  it("does not sign out or revalidate when there was no Handle to release", async () => {
    releaseHandle.mockResolvedValueOnce({ state: "no-handle" });

    const landed = await run(form(CONFIRMED));

    expect(landed).toBe("/account?error=failed");
    expect(signOut).not.toHaveBeenCalled();
    expect(calls).toEqual(["redirect:/account?error=failed"]);
  });
});
