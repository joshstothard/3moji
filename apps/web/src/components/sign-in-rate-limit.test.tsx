import { cleanup, render, screen } from "@testing-library/react";
import type * as Core from "@template/core";

import en from "../../../../packages/shared/messages/en.json";

/**
 * **The sign-in form's rate limit, from the form to the store**
 * ([#180](https://github.com/joshstothard/3moji/issues/180)).
 *
 * Better Auth limits `POST /api/auth/sign-in/email` to
 * `AUTH_RATE_LIMITS.signInEmail`, but its limiter runs only in its router, and
 * the form is a server action that calls `auth.api.signInEmail` directly. This
 * suite measures that gap and proves it closed.
 *
 * The approach is `claim-rate-limit.test.tsx`'s: the **real**
 * `signInFormAction`, the **real** limiter from source with its keyed buckets
 * over the in-memory store that honours the adapter's contract, the **real**
 * `redirect` throw and the **real** sign-in page. Only the edges are fakes:
 * Better Auth's `signInEmail` (answering from a table of registered Accounts),
 * the Account directory and the request headers.
 *
 * Every "identical" is paired with proof the scenarios really took different
 * paths below the limit, or it would be satisfied by running one scenario four
 * times.
 */

const { createSignInClientRateLimiter, SIGN_IN_CLIENT_RATE_LIMIT } =
  jest.requireActual<{
    readonly createSignInClientRateLimiter: typeof Core.createSignInClientRateLimiter;
    readonly SIGN_IN_CLIENT_RATE_LIMIT: typeof Core.SIGN_IN_CLIENT_RATE_LIMIT;
  }>("../../../../packages/core/src/auth/sign-in-rate-limit");
const { AUTH_RATE_LIMITS } = jest.requireActual<{
  readonly AUTH_RATE_LIMITS: typeof Core.AUTH_RATE_LIMITS;
}>("../../../../packages/core/src/auth/auth-rate-limit");
const { createInMemoryClaimRateLimitStore } = jest.requireActual<{
  readonly createInMemoryClaimRateLimitStore: typeof Core.createInMemoryClaimRateLimitStore;
}>("../../../../packages/core/src/adapters/in-memory-claim-rate-limit-store");
const { DatabaseQueryFailed } = jest.requireActual<{
  readonly DatabaseQueryFailed: new (
    code: string | undefined,
    constraint: string | undefined,
  ) => Error;
}>("../../../../packages/core/src/db/database-error");
const realCanonicalise = jest.requireActual<Pick<typeof Core, "canonicalise">>(
  "../../../../packages/core/src/handle/canonicalise",
);

jest.mock("@template/core", () => ({
  canonicalise: (segment: string) => realCanonicalise.canonicalise(segment),
}));

/** Better Auth's HTTP limit: what the form must not exceed. */
const HTTP_MAX = AUTH_RATE_LIMITS.signInEmail.max;

const NOW = new Date("2026-09-13T12:05:00.000Z");
const CLIENT = "203.0.113.7";
const REGISTERED = "owner@example.com";
const UNREGISTERED = "nobody@example.com";
const RIGHT = "correct horse battery staple";
const WRONG = "Tr0ub4dor&3-wrong";

/** One world: its own counters, its own Accounts, its own call log. */
interface World {
  limiter: Core.SignInClientRateLimiter;
  signInCalls: number;
  lookups: number;
  clientAddress: string | undefined;
  storeFails: boolean;
}

const freshWorld = (): World => {
  const store = createInMemoryClaimRateLimitStore();
  const world: World = {
    signInCalls: 0,
    lookups: 0,
    clientAddress: CLIENT,
    storeFails: false,
    limiter: { admit: () => Promise.resolve({ state: "admitted" }) },
  };
  world.limiter = createSignInClientRateLimiter({
    store: {
      record: (hits, forgetBefore) =>
        world.storeFails
          ? // What the Drizzle adapter rejects with: a code, and no values.
            Promise.reject(new DatabaseQueryFailed("ECONNREFUSED", undefined))
          : store.record(hits, forgetBefore),
    },
    clock: { now: () => NOW },
    secret: "s".repeat(32),
  });
  return world;
};

let world = freshWorld();

/** Better Auth's `signInEmail`, answering from one verified Account. */
const signInEmail = (request: {
  readonly body: { readonly email: string; readonly password: string };
}): Promise<unknown> => {
  world.signInCalls += 1;
  if (request.body.email === REGISTERED && request.body.password === RIGHT) {
    return Promise.resolve({ token: "session" });
  }
  return Promise.reject(
    Object.assign(new Error("Invalid email or password"), {
      status: "UNAUTHORIZED",
      body: { code: "INVALID_EMAIL_OR_PASSWORD" },
    }),
  );
};

jest.mock("../lib/services", () => ({
  getServices: () => ({
    auth: { api: { signInEmail } },
    accounts: {
      byEmail: () => {
        world.lookups += 1;
        return Promise.resolve(undefined);
      },
      handleOf: () => Promise.resolve(undefined),
    },
    signInClientRateLimiter: world.limiter,
  }),
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

/** Every line written to any console stream, for the no-leak assertions. */
const written: string[] = [];

const REDIRECT = "NEXT_REDIRECT";
const redirected: string[] = [];
const navigation = jest.requireActual<{
  readonly redirect: (url: string) => never;
  readonly notFound: () => never;
}>("next/navigation");
jest.mock("next/navigation", () => ({
  redirect: (url: string): never => {
    redirected.push(url);
    return navigation.redirect(url);
  },
  notFound: (): never => navigation.notFound(),
}));

import SignInPage from "../app/sign-in/page";
import { signInAction, signInFormAction } from "./sign-in-action";

function messageOf(error: unknown): unknown {
  if (typeof error === "object" && error !== null && "message" in error) {
    return error.message;
  }
  return error;
}

function form(email: string, password: string): FormData {
  const data = new FormData();
  data.set("email", email);
  data.set("password", password);
  return data;
}

/** A copy of `record` without `key`: the one field allowed to differ. */
function without(
  record: Readonly<Record<string, unknown>>,
  key: string,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(record).filter(([name]) => name !== key),
  );
}

function boundaryLinesWritten(): Record<string, unknown>[] {
  return written.flatMap((text) => {
    try {
      const value: unknown = JSON.parse(text);
      return typeof value === "object" &&
        value !== null &&
        "event" in value &&
        value.event === "api_boundary"
        ? [Object.fromEntries(Object.entries(value))]
        : [];
    } catch {
      return [];
    }
  });
}

/** One submission through the form, and everything a caller can observe. */
async function submit(email: string, password: string) {
  redirected.length = 0;
  written.length = 0;
  const callsBefore = world.signInCalls;
  const lookupsBefore = world.lookups;

  let thrown: unknown;
  try {
    await signInFormAction(form(email, password));
  } catch (error) {
    thrown = messageOf(error);
  }

  // Every field but the duration, which is wall-clock time.
  const boundary = boundaryLinesWritten().map((line) =>
    without(line, "durationMs"),
  );
  return {
    observable: { thrown, redirected: [...redirected], boundary },
    credentialsEvaluated: world.signInCalls - callsBefore,
    lookups: world.lookups - lookupsBefore,
  };
}

/** The sign-in page a redirect lands on, as markup. */
async function pageAt(destination: string) {
  const url = new URL(destination, "https://3moji.me");
  const { container } = render(
    await SignInPage({
      searchParams: Promise.resolve(
        Object.fromEntries(url.searchParams.entries()),
      ),
    }),
  );
  const snapshot = {
    html: container.innerHTML,
    announced: screen.queryByRole("alert")?.textContent ?? null,
    focused: document.activeElement?.tagName,
  };
  cleanup();
  return snapshot;
}

/** Spend the client's whole allowance on wrong guesses at another address. */
async function exhaust(): Promise<void> {
  for (let attempt = 0; attempt < HTTP_MAX; attempt += 1) {
    await submit(`someone-${String(attempt)}@example.com`, WRONG);
  }
}

beforeEach(() => {
  world = freshWorld();
  for (const stream of ["log", "info", "warn", "error", "debug"] as const) {
    jest.spyOn(console, stream).mockImplementation((...args: unknown[]) => {
      written.push(args.map((arg) => String(arg)).join(" "));
    });
  }
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("the sign-in form's rate limit (#180)", () => {
  it("accepts no more attempts from one client than Better Auth's HTTP endpoint allows", async () => {
    const outcomes = [];
    for (let attempt = 0; attempt <= HTTP_MAX; attempt += 1) {
      outcomes.push(await submit(UNREGISTERED, WRONG));
    }

    // The measurement: how many guesses reached the credential check.
    expect(world.signInCalls).toBe(HTTP_MAX);
    expect(outcomes.at(-1)?.observable.redirected).toEqual([
      "/sign-in?error=rate-limited",
    ]);
    expect(outcomes.at(-1)?.credentialsEvaluated).toBe(0);
  });

  it("uses the same numbers as the HTTP endpoint", () => {
    expect(SIGN_IN_CLIENT_RATE_LIMIT).toEqual({
      maxPerWindow: AUTH_RATE_LIMITS.signInEmail.max,
      windowMs: AUTH_RATE_LIMITS.signInEmail.window * 1000,
    });
  });

  it("refuses a registered and an unregistered address, a right and a wrong password, identically", async () => {
    const cells = [
      ["a registered address, right password", REGISTERED, RIGHT],
      ["a registered address, wrong password", REGISTERED, WRONG],
      ["an unregistered address, right password", UNREGISTERED, RIGHT],
      ["an unregistered address, wrong password", UNREGISTERED, WRONG],
    ] as const;

    // Below the limit the four really differ: only one of them signs in.
    const below = [];
    for (const [, email, password] of cells) {
      world = freshWorld();
      below.push((await submit(email, password)).observable.redirected);
    }
    expect(below).toEqual([
      ["/"],
      ["/sign-in?error=invalid"],
      ["/sign-in?error=invalid"],
      ["/sign-in?error=invalid"],
    ]);

    // Beyond it, nothing a caller can observe differs.
    const beyond = [];
    for (const [who, email, password] of cells) {
      world = freshWorld();
      await exhaust();
      const outcome = await submit(email, password);
      const [destination] = outcome.observable.redirected;
      if (destination === undefined) throw new Error(`${who} did not redirect`);
      beyond.push({
        who,
        observable: outcome.observable,
        // The limit is decided before credentials are evaluated, so no
        // credential-dependent work runs and no timing can differ by it.
        credentialsEvaluated: outcome.credentialsEvaluated,
        lookups: outcome.lookups,
        page: await pageAt(destination),
      });
    }

    const [first, ...rest] = beyond;
    if (first === undefined) throw new Error("no outcome");
    const expected = without(first, "who");
    for (const outcome of rest) {
      expect(without(outcome, "who")).toEqual(expected);
    }
    expect(expected).toEqual({
      observable: {
        thrown: REDIRECT,
        redirected: ["/sign-in?error=rate-limited"],
        boundary: [
          {
            event: "api_boundary",
            boundary: "sign-in.form",
            outcome: "rate-limited",
            correlationId: "none",
          },
        ],
      },
      credentialsEvaluated: 0,
      lookups: 0,
      page: expect.objectContaining({
        announced: en.Claim.signInRateLimited,
      }) as unknown,
    });
  });

  it("answers the state-returning action with rate-limited, the same for every address and password", async () => {
    await exhaust();

    const answers = [];
    for (const [email, password] of [
      [REGISTERED, RIGHT],
      [UNREGISTERED, WRONG],
    ] as const) {
      answers.push(await signInAction(form(email, password)));
    }

    expect(answers).toEqual([
      { state: "rate-limited" },
      { state: "rate-limited" },
    ]);
    expect(world.signInCalls).toBe(HTTP_MAX);
  });

  it("does not limit a different client", async () => {
    await exhaust();
    world.clientAddress = "198.51.100.9";

    const outcome = await submit(REGISTERED, RIGHT);

    expect(outcome.observable.redirected).toEqual(["/"]);
  });

  it("limits requests with no readable address in one shared bucket, rather than not at all", async () => {
    world.clientAddress = undefined;
    await exhaust();

    const outcome = await submit(REGISTERED, RIGHT);

    expect(outcome.observable.redirected).toEqual([
      "/sign-in?error=rate-limited",
    ]);
  });

  it("fails closed when the limiter's store cannot count, logging it without the address or password", async () => {
    world.storeFails = true;

    const outcome = await submit(REGISTERED, RIGHT);

    expect(outcome.observable.redirected).toEqual(["/sign-in?error=failed"]);
    expect(outcome.credentialsEvaluated).toBe(0);
    const everything = written.join("\n");
    expect(everything).toContain("sign_in_rate_limit_failed");
    expect(everything).toContain("DatabaseQueryFailed");
    expect(everything).toContain("ECONNREFUSED");
    expect(everything).not.toContain(REGISTERED);
    expect(everything).not.toContain(RIGHT);
    expect(everything).not.toContain(CLIENT);
    expect(outcome.observable.boundary).toEqual([
      expect.objectContaining({ outcome: "failed" }),
    ]);
  });
});
