import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type * as Core from "@template/core";

import en from "../../../../packages/shared/messages/en.json";

/**
 * **The Claim's rate limit, kept all the way to the screen**
 * ([#157](https://github.com/joshstothard/3moji/issues/157)).
 *
 * The approach is `claim-non-enumeration.test.tsx`'s: the **real**
 * `submitClaim`, behind the **real** `submitClaimAction`, rendered by the
 * **real** form — and here the **real** limiter too, with its keyed buckets
 * and its decision, over the in-memory store that honours the adapter's
 * contract. Only the edges are fakes: the claim store, the Account directory,
 * the email sender, the request headers and the sleep behind the response
 * floor, which is recorded rather than waited on.
 *
 * Three promises are proved, each by comparing **everything observable** —
 * the action's answer, anything it threw, where it redirected, how long the
 * response floor held it, and the form a person is left looking at:
 *
 * 1. A registered address is limited exactly as an unregistered one is.
 * 2. The client-address limit and the email-address limit are
 *    indistinguishable from each other.
 * 3. The collision notice is covered by the per-email limit.
 *
 * Every "identical" is paired with an assertion that the two scenarios really
 * took different paths, or it would be satisfied by running one scenario twice.
 */

/** Everything the response floor asked to sleep, in order. */
const slept: number[] = [];

jest.mock("@template/core", () => {
  const submit = jest.requireActual<{
    readonly submitClaim: typeof Core.submitClaim;
  }>("../../../../packages/core/src/handle/submit-claim");
  return { submitClaim: submit.submitClaim };
});

// The floor's real sleep, recorded instead of waited on. The clock below does
// not move, so every padded answer asks for the whole floor.
jest.mock("../../../../packages/core/src/auth/response-floor", () => {
  // Typed as the package exports it: a type import by relative path would
  // pull core's sources into this project's rootDir.
  const actual = jest.requireActual<{
    readonly RESPONSE_FLOOR_MS: typeof Core.RESPONSE_FLOOR_MS;
    readonly withResponseFloor: typeof Core.withResponseFloor;
  }>("../../../../packages/core/src/auth/response-floor");
  return {
    ...actual,
    realSleep: (ms: number) => {
      slept.push(ms);
      return Promise.resolve();
    },
  };
});

const { createClaimRateLimiter, CLAIM_RATE_LIMITS } = jest.requireActual<{
  readonly createClaimRateLimiter: typeof Core.createClaimRateLimiter;
  readonly CLAIM_RATE_LIMITS: typeof Core.CLAIM_RATE_LIMITS;
}>("../../../../packages/core/src/handle/claim-rate-limit");
const { createInMemoryClaimRateLimitStore } = jest.requireActual<{
  readonly createInMemoryClaimRateLimitStore: typeof Core.createInMemoryClaimRateLimitStore;
}>("../../../../packages/core/src/adapters/in-memory-claim-rate-limit-store");

const ICE = "\u{1F9CA}\u{1F9CA}\u{1F9CA}";
const ENCODED = "%F0%9F%A7%8A%F0%9F%A7%8A%F0%9F%A7%8A";
const PASSWORD = "correct horse battery staple";
const NOW = new Date("2026-09-13T12:00:00.000Z");
const PENDING = `/claim/held/${ENCODED}?reason=pending`;

const EMAIL_LIMIT = CLAIM_RATE_LIMITS.perEmailAddress.maxPerWindow;
const CLIENT_LIMIT = CLAIM_RATE_LIMITS.perClientAddress.maxPerWindow;

interface SentEmail {
  readonly to: string;
}

interface WorkOutcome {
  readonly commit: boolean;
  readonly value: unknown;
}

/** One world: its own counters, its own registered addresses, its own mail. */
interface World {
  registered: Set<string>;
  limiter: Core.ClaimRateLimiter;
  accountsCreated: number;
  sent: SentEmail[];
  clientAddress: string | undefined;
  storeFails: boolean;
}

const freshWorld = (registered: readonly string[] = []): World => {
  const store = createInMemoryClaimRateLimitStore();
  const world: World = {
    registered: new Set(registered),
    accountsCreated: 0,
    sent: [],
    clientAddress: undefined,
    storeFails: false,
    limiter: { admit: () => Promise.resolve("admitted") },
  };
  world.limiter = createClaimRateLimiter({
    store: {
      record: (hits, forgetBefore) =>
        world.storeFails
          ? Promise.reject(new Error("the limiter's store is unreachable"))
          : store.record(hits, forgetBefore),
    },
    clock: { now: () => NOW },
    secret: "s".repeat(32),
  });
  return world;
};

let world = freshWorld();

const services = () => ({
  clock: { now: () => NOW },
  claimRateLimiter: world.limiter,
  claims: {
    runInTransaction: async (
      work: (tx: Readonly<Record<string, unknown>>) => Promise<WorkOutcome>,
    ) => {
      const outcome = await work({
        availabilityOf: () => Promise.resolve("available"),
        freeExpiredHold: () => Promise.resolve({ freed: false }),
        createAccount: (account: { readonly email: string }) => {
          world.accountsCreated += 1;
          return Promise.resolve(
            world.registered.has(account.email)
              ? { ok: false, reason: "email-taken" }
              : { ok: true, userId: "user-new" },
          );
        },
        holdHandle: () => Promise.resolve({ ok: true }),
      });
      return outcome.value;
    },
  },
  accounts: {
    byEmail: (email: string) =>
      Promise.resolve(
        world.registered.has(email)
          ? { userId: "user-9", email, emailVerified: true }
          : undefined,
      ),
    handleOf: () =>
      Promise.resolve({
        key: ICE,
        heldUntil: new Date("2026-09-14T12:00:00.000Z"),
        claimedAt: new Date("2026-09-13T09:00:00.000Z"),
      }),
  },
  emailSender: {
    send: (email: SentEmail) => {
      world.sent.push(email);
      return Promise.resolve();
    },
  },
  resetRequestUrl: "http://localhost:3000/reset-password",
  emailFrom: "3moji <no-reply@mail.3moji.me>",
});
jest.mock("../lib/services", () => ({
  getServices: () => services(),
}));

jest.mock("next/headers", () => ({
  headers: () =>
    Promise.resolve(
      new Headers(
        world.clientAddress === undefined
          ? {}
          : { "x-vercel-forwarded-for": world.clientAddress },
      ),
    ),
}));

const logFailure = jest.fn(
  (_event: string, _error: unknown): undefined => undefined,
);
jest.mock("../lib/log-error", () => ({
  logFailure: (event: string, error: unknown) => {
    logFailure(event, error);
  },
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

import { submitClaimAction, type ClaimFormState } from "./claim-action";
import { ClaimForm } from "./claim-form";

function messageOf(error: unknown): unknown {
  if (typeof error === "object" && error !== null && "message" in error) {
    return error.message;
  }
  return error;
}

function formData(email: string): FormData {
  const data = new FormData();
  data.set("handle", ENCODED);
  data.set("email", email);
  data.set("password", PASSWORD);
  return data;
}

/** One submission, and everything a caller can observe of it. */
async function submit(email: string, clientAddress: string | undefined) {
  world.clientAddress = clientAddress;
  redirected.length = 0;
  slept.length = 0;

  let returned: unknown;
  let thrown: unknown;
  try {
    returned = await submitClaimAction(formData(email));
  } catch (error) {
    thrown = messageOf(error);
  }
  return {
    returned,
    thrown,
    redirected: [...redirected],
    slept: [...slept],
  };
}

/** The form a person is left looking at after one submission. */
async function formAfter(email: string, clientAddress: string | undefined) {
  world.clientAddress = clientAddress;
  redirected.length = 0;
  slept.length = 0;

  const claim = async (
    _previous: ClaimFormState,
    data: FormData,
  ): Promise<ClaimFormState> => {
    try {
      return await submitClaimAction(data);
    } catch (error) {
      if (messageOf(error) === REDIRECT) {
        return new Promise<ClaimFormState>(() => undefined);
      }
      throw error;
    }
  };

  const user = userEvent.setup();
  const { container } = render(<ClaimForm claim={claim} handle={ENCODED} />);
  await user.type(screen.getByLabelText(en.Claim.claimEmailLabel), email);
  await user.type(screen.getByLabelText(en.Claim.claimPasswordLabel), PASSWORD);
  await user.click(screen.getByRole("button", { name: en.Claim.claimSubmit }));
  await waitFor(() => {
    expect(screen.getByRole("alert").textContent).not.toBe("");
  });

  const snapshot = {
    // The email field keeps what was typed; the addresses differ by design
    // between scenarios, so the value is blanked before comparing markup.
    html: container.innerHTML.replaceAll(email, "EMAIL"),
    focused: document.activeElement?.outerHTML,
    announced: screen.getByRole("alert").textContent,
    slept: [...slept],
  };
  cleanup();
  return snapshot;
}

const RATE_LIMITED = {
  returned: { state: "rate-limited" },
  thrown: undefined,
  redirected: [],
  slept: [500],
};

describe("the Claim's rate limit, from the form to the store (#157)", () => {
  beforeEach(() => {
    logFailure.mockClear();
  });

  afterEach(() => {
    cleanup();
  });

  it("limits a registered address exactly as it limits an unregistered one", async () => {
    const REGISTERED = "owner@example.com";
    const UNREGISTERED = "nobody@example.com";

    const run = async (email: string, registered: readonly string[]) => {
      world = freshWorld(registered);
      const outcomes = [];
      // A different client address every time, so only the email limit binds.
      for (let attempt = 0; attempt <= EMAIL_LIMIT + 1; attempt += 1) {
        outcomes.push(await submit(email, `198.51.100.${String(attempt + 1)}`));
      }
      return {
        outcomes,
        accountsCreated: world.accountsCreated,
        sent: world.sent.length,
      };
    };

    const unregistered = await run(UNREGISTERED, []);
    const registered = await run(REGISTERED, [REGISTERED]);

    // The two really differed: only the registered address's owner was told.
    expect(unregistered.sent).toBe(0);
    expect(registered.sent).toBe(EMAIL_LIMIT);

    // ...and nothing a caller can observe differs, submission by submission.
    expect(registered.outcomes).toEqual(unregistered.outcomes);
    expect(unregistered.outcomes.slice(0, EMAIL_LIMIT)).toEqual(
      Array(EMAIL_LIMIT).fill({
        returned: undefined,
        thrown: REDIRECT,
        redirected: [PENDING],
        slept: [500],
      }),
    );
    expect(unregistered.outcomes.slice(EMAIL_LIMIT)).toEqual([
      RATE_LIMITED,
      RATE_LIMITED,
    ]);
    // The domain was not called for either refusal.
    expect(unregistered.accountsCreated).toBe(EMAIL_LIMIT);
    expect(registered.accountsCreated).toBe(EMAIL_LIMIT);
  });

  it("does not reveal whether the client-address limit or the email-address limit was hit", async () => {
    // The client-address limit: one address, a new email every time.
    world = freshWorld();
    for (let attempt = 0; attempt < CLIENT_LIMIT; attempt += 1) {
      await submit(`person-${String(attempt)}@example.com`, "203.0.113.7");
    }
    const clientCreated = world.accountsCreated;
    const byClientAddress = await submit(
      "fresh-one@example.com",
      "203.0.113.7",
    );
    const clientForm = await formAfter("fresh-two@example.com", "203.0.113.7");
    expect(world.accountsCreated).toBe(clientCreated);

    // The email-address limit: one email, a new client address every time.
    world = freshWorld();
    for (let attempt = 0; attempt < EMAIL_LIMIT; attempt += 1) {
      await submit("target@example.com", `198.51.100.${String(attempt + 1)}`);
    }
    const emailCreated = world.accountsCreated;
    const byEmailAddress = await submit("target@example.com", "192.0.2.1");
    const emailForm = await formAfter("target@example.com", "192.0.2.2");
    expect(world.accountsCreated).toBe(emailCreated);

    // The two really were different limits.
    expect(clientCreated).toBe(CLIENT_LIMIT);
    expect(emailCreated).toBe(EMAIL_LIMIT);

    // One answer, one floor, one screen.
    expect(byClientAddress).toEqual(RATE_LIMITED);
    expect(byEmailAddress).toEqual(byClientAddress);
    expect(emailForm).toEqual(clientForm);
    expect(clientForm.announced).toBe(en.Claim.claimRateLimited);
    expect(clientForm.slept).toEqual([500]);
  });

  it("covers the collision notice, so one inbox cannot be flooded", async () => {
    const OWNER = "owner@example.com";
    world = freshWorld([OWNER]);

    for (let attempt = 0; attempt < EMAIL_LIMIT * 4; attempt += 1) {
      await submit(OWNER, `198.51.100.${String(attempt + 1)}`);
    }

    expect(world.sent).toHaveLength(EMAIL_LIMIT);
    expect(world.sent.every((sent) => sent.to === OWNER)).toBe(true);
  });

  it("counts an address typed with capitals against the same counter (#163)", async () => {
    world = freshWorld();
    const typings = [
      "Someone@Example.com",
      "someone@example.com",
      "  SOMEONE@example.COM",
      "someone@EXAMPLE.com",
    ];

    const outcomes = [];
    for (const [attempt, email] of typings.entries()) {
      outcomes.push(await submit(email, `198.51.100.${String(attempt + 1)}`));
    }

    expect(outcomes.map((outcome) => outcome.redirected.length)).toEqual([
      1, 1, 1, 0,
    ]);
    expect(outcomes[EMAIL_LIMIT]).toEqual(RATE_LIMITED);
  });

  it("puts a request with no forwarded address in one shared bucket", async () => {
    world = freshWorld();
    for (let attempt = 0; attempt < CLIENT_LIMIT; attempt += 1) {
      await submit(`person-${String(attempt)}@example.com`, undefined);
    }

    expect(await submit("one-more@example.com", undefined)).toEqual(
      RATE_LIMITED,
    );
  });

  it("fails closed: a limiter whose store cannot be reached refuses the Claim and logs it", async () => {
    world = freshWorld();
    world.storeFails = true;

    const outcome = await submit("someone@example.com", "203.0.113.7");

    expect(outcome.returned).toEqual({ state: "failed" });
    expect(outcome.redirected).toEqual([]);
    expect(outcome.slept).toEqual([500]);
    expect(world.accountsCreated).toBe(0);
    expect(world.sent).toEqual([]);
    expect(logFailure).toHaveBeenCalledTimes(1);
    expect(logFailure.mock.calls[0]?.[0]).toBe("claim_submit_failed");
  });
});
