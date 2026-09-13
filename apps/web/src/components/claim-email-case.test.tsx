import type * as Core from "@template/core";

/**
 * **A capital letter in the address changes nothing a caller can observe**
 * ([#163](https://github.com/joshstothard/3moji/issues/163)).
 *
 * The approach is `claim-non-enumeration.test.tsx`'s: the **real**
 * `submitClaim` behind the **real** `submitClaimAction`, with only the edges
 * faked. What differs is the fake store, which here models the database the
 * real adapter talks to rather than answering by scenario:
 *
 * - Registered addresses are stored **lowercased**, because Better Auth
 *   lowercases every address it writes.
 * - The store compares the address it is handed **byte for byte**, as the
 *   adapter's `eq(user.email, …)` reads do.
 * - A new address that is not already lowercase is written lowercased and then
 *   not found by the exact read-back, so the adapter throws — which is what it
 *   did on `main` before #163.
 *
 * A fake that lowercased on its own would make every assertion here vacuous;
 * the point is to prove the address is normalised **before** it reaches the
 * store.
 */
jest.mock("@template/core", () => {
  const actual = jest.requireActual<{
    readonly submitClaim: typeof Core.submitClaim;
  }>("../../../../packages/core/src/handle/submit-claim");
  return { submitClaim: actual.submitClaim };
});

const ICE = "\u{1F9CA}\u{1F9CA}\u{1F9CA}";
const ENCODED = "%F0%9F%A7%8A%F0%9F%A7%8A%F0%9F%A7%8A";
const REGISTERED = "someone@example.com";
const PASSWORD = "correct horse battery staple";
const NOW = new Date("2026-09-13T12:00:00.000Z");

interface SentEmail {
  readonly to: string;
}

interface WorkOutcome {
  readonly commit: boolean;
  readonly value: unknown;
}

interface AccountInput {
  readonly email: string;
}

const seen: {
  created: string[];
  lookedUp: string[];
  sent: SentEmail[];
} = { created: [], lookedUp: [], sent: [] };

/** Addresses with an Account, exactly as Better Auth stored them. */
const stored = new Set<string>([REGISTERED]);

const createAccount = (account: AccountInput) => {
  seen.created.push(account.email);
  // The adapter's case-sensitive pre-read.
  if (stored.has(account.email)) {
    return Promise.resolve({ ok: false, reason: "email-taken" });
  }
  // Better Auth lowercases, then either finds the lowercased address (and
  // answers with its generic success) or inserts it lowercased. Either way the
  // adapter's exact read-back finds nothing unless the address was lowercase.
  if (account.email !== account.email.toLowerCase()) {
    return Promise.reject(
      new Error(
        "sign-up reported success but no user row is visible in the claim transaction.",
      ),
    );
  }
  return Promise.resolve({ ok: true, userId: "user-new" });
};

const services = () => ({
  clock: { now: () => NOW },
  claims: {
    runInTransaction: async (
      work: (tx: Readonly<Record<string, unknown>>) => Promise<WorkOutcome>,
    ) => {
      const outcome = await work({
        availabilityOf: () => Promise.resolve("available"),
        freeExpiredHold: () => Promise.resolve({ freed: false }),
        createAccount,
        holdHandle: () => Promise.resolve({ ok: true }),
      });
      return outcome.value;
    },
  },
  accounts: {
    byEmail: (email: string) => {
      seen.lookedUp.push(email);
      return Promise.resolve(
        stored.has(email)
          ? { userId: "user-9", email, emailVerified: true }
          : undefined,
      );
    },
    handleOf: () =>
      Promise.resolve({
        key: ICE,
        heldUntil: new Date("2026-09-14T12:00:00.000Z"),
        claimedAt: new Date("2026-09-13T09:00:00.000Z"),
      }),
  },
  emailSender: {
    send: (email: SentEmail) => {
      seen.sent.push(email);
      return Promise.resolve();
    },
  },
  resetRequestUrl: "http://localhost:3000/reset-password",
  emailFrom: "3moji <no-reply@mail.3moji.me>",
});
jest.mock("../lib/services", () => ({
  getServices: () => services(),
}));

jest.mock("../lib/log-error", () => ({
  logFailure: jest.fn(),
}));

const REDIRECT = "NEXT_REDIRECT";
const redirected: string[] = [];
jest.mock("next/navigation", () => ({
  redirect: (url: string): never => {
    redirected.push(url);
    throw new Error(REDIRECT);
  },
  notFound: (): never => {
    throw new Error("NEXT_HTTP_ERROR_FALLBACK;404");
  },
}));

import { submitClaimAction } from "./claim-action";

function messageOf(error: unknown): unknown {
  if (typeof error === "object" && error !== null && "message" in error) {
    return error.message;
  }
  return error;
}

/** Everything the action does that a caller — or the owner — can observe. */
async function outcomeFor(email: string) {
  seen.created = [];
  seen.lookedUp = [];
  seen.sent = [];
  redirected.length = 0;

  const data = new FormData();
  data.set("handle", ENCODED);
  data.set("email", email);
  data.set("password", PASSWORD);

  let returned: unknown;
  let thrown: unknown;
  try {
    returned = await submitClaimAction(data);
  } catch (error) {
    thrown = messageOf(error);
  }
  return {
    observable: { returned, thrown, redirected: [...redirected] },
    ownerMailed: seen.sent.map((sent) => sent.to),
    created: [...seen.created],
    lookedUp: [...seen.lookedUp],
  };
}

describe("an address typed with capitals (#163)", () => {
  it("gets exactly the answer its lowercase form gets when it is registered", async () => {
    const lowercase = await outcomeFor(REGISTERED);
    const mixedCase = await outcomeFor("  Someone@Example.COM ");

    // The baseline is the collision path: the hold screen, and the owner told.
    expect(lowercase.observable).toEqual({
      returned: undefined,
      thrown: REDIRECT,
      redirected: [`/claim/held/${ENCODED}?reason=pending`],
    });
    expect(lowercase.ownerMailed).toEqual([REGISTERED]);

    // Nothing differs — not for the submitter, and not for the owner.
    expect(mixedCase).toEqual(lowercase);
  });

  it("gets the same answer a genuinely new address gets", async () => {
    const fresh = await outcomeFor("newcomer@example.com");
    const mixedCaseRegistered = await outcomeFor("Someone@Example.com");

    // The two really took different paths: only the collision told an owner.
    expect(fresh.ownerMailed).toEqual([]);
    expect(mixedCaseRegistered.ownerMailed).toEqual([REGISTERED]);
    expect(mixedCaseRegistered.observable).toEqual(fresh.observable);
  });

  it("claims a new address typed with capitals, under its lowercase form", async () => {
    const outcome = await outcomeFor("Newcomer@Example.com");

    expect(outcome.observable).toEqual({
      returned: undefined,
      thrown: REDIRECT,
      redirected: [`/claim/held/${ENCODED}?reason=pending`],
    });
    expect(outcome.created).toEqual(["newcomer@example.com"]);
  });
});
