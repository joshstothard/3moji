import { cleanup, render, screen } from "@testing-library/react";
import type * as Core from "@template/core";

import en from "../../../../packages/shared/messages/en.json";

/**
 * **The password reset request form, from the form to the domain**
 * ([#192](https://github.com/joshstothard/3moji/issues/192)): non-enumeration,
 * timing and the per-client limit.
 *
 * The approach is `claim-non-enumeration.test.tsx`'s and
 * `sign-in-rate-limit.test.tsx`'s: the **real** `requestPasswordResetFormAction`,
 * the **real** `requestPasswordReset` use case with its **real** 500 ms floor
 * and real sleep, the **real** limiter over the in-memory store that honours
 * the adapter's contract, the **real** `redirect` throw and the **real** request
 * page. Only the edges are fakes: Better Auth (a resetter answering from a table
 * of registered Accounts, mailing only those) and the request headers.
 *
 * Every "identical" is paired with proof the scenarios took different paths,
 * or it would be satisfied by running one scenario twice.
 */

const { requestPasswordReset } = jest.requireActual<{
  readonly requestPasswordReset: typeof Core.requestPasswordReset;
}>("../../../../packages/core/src/auth/password-reset");
const { createResetRequestClientRateLimiter, RESET_REQUEST_CLIENT_RATE_LIMIT } =
  jest.requireActual<{
    readonly createResetRequestClientRateLimiter: typeof Core.createResetRequestClientRateLimiter;
    readonly RESET_REQUEST_CLIENT_RATE_LIMIT: typeof Core.RESET_REQUEST_CLIENT_RATE_LIMIT;
  }>("../../../../packages/core/src/auth/reset-request-rate-limit");
const { AUTH_RATE_LIMITS } = jest.requireActual<{
  readonly AUTH_RATE_LIMITS: typeof Core.AUTH_RATE_LIMITS;
}>("../../../../packages/core/src/auth/auth-rate-limit");
const { RESPONSE_FLOOR_MS } = jest.requireActual<{
  readonly RESPONSE_FLOOR_MS: number;
}>("../../../../packages/core/src/auth/response-floor");
const { createInMemoryClaimRateLimitStore } = jest.requireActual<{
  readonly createInMemoryClaimRateLimitStore: typeof Core.createInMemoryClaimRateLimitStore;
}>("../../../../packages/core/src/adapters/in-memory-claim-rate-limit-store");
const { DatabaseQueryFailed } = jest.requireActual<{
  readonly DatabaseQueryFailed: new (
    code: string | undefined,
    constraint: string | undefined,
  ) => Error;
}>("../../../../packages/core/src/db/database-error");

jest.mock("@template/core", () => ({
  requestPasswordReset: (input: Core.RequestPasswordResetInput) =>
    requestPasswordReset(input),
}));

/** Better Auth's HTTP limit: what the form must not exceed. */
const HTTP_MAX = AUTH_RATE_LIMITS.requestPasswordReset.max;

const CLIENT = "203.0.113.7";
const REGISTERED = "owner@example.com";
const UNREGISTERED = "nobody@example.com";

/** One world: its own counters, its own call log. */
interface World {
  limiter: Core.ResetRequestClientRateLimiter;
  requests: number;
  mailed: string[];
  clientAddress: string | undefined;
  storeFails: boolean;
}

const freshWorld = (): World => {
  const store = createInMemoryClaimRateLimitStore();
  const world: World = {
    requests: 0,
    mailed: [],
    clientAddress: CLIENT,
    storeFails: false,
    limiter: { admit: () => Promise.resolve({ state: "admitted" }) },
  };
  world.limiter = createResetRequestClientRateLimiter({
    store: {
      record: (hits, forgetBefore) =>
        world.storeFails
          ? Promise.reject(new DatabaseQueryFailed("ECONNREFUSED", undefined))
          : store.record(hits, forgetBefore),
    },
    clock: { now: () => new Date() },
    secret: "s".repeat(32),
  });
  return world;
};

let world = freshWorld();

/** Better Auth's `requestPasswordReset`, mailing only a registered address. */
const resetter: Core.PasswordResetter = {
  request: (email) => {
    world.requests += 1;
    if (email === REGISTERED) world.mailed.push(email);
    return Promise.resolve("accepted");
  },
  reset: () => Promise.resolve({ state: "reset" }),
};

jest.mock("../lib/services", () => ({
  getServices: () => ({
    // The real clock: the floor is measured in real time here.
    clock: { now: () => new Date() },
    resetRequestClientRateLimiter: world.limiter,
    passwordResetter: resetter,
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

const written: string[] = [];
const redirected: string[] = [];
const navigation = jest.requireActual<{
  readonly redirect: (url: string) => never;
}>("next/navigation");
jest.mock("next/navigation", () => ({
  redirect: (url: string): never => {
    redirected.push(url);
    return navigation.redirect(url);
  },
}));

jest.mock("next/link", () => ({
  __esModule: true,
  default: ({
    href,
    children,
    className,
  }: {
    readonly href: string;
    readonly children: React.ReactNode;
    readonly className?: string;
  }) => (
    <a className={className} href={href}>
      {children}
    </a>
  ),
}));

import ResetPasswordPage from "../app/reset-password/page";
import { requestPasswordResetFormAction } from "./password-reset-action";

function messageOf(error: unknown): unknown {
  return typeof error === "object" && error !== null && "message" in error
    ? error.message
    : error;
}

function form(email: string): FormData {
  const data = new FormData();
  data.set("email", email);
  return data;
}

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
async function submit(email: string) {
  redirected.length = 0;
  written.length = 0;
  const requestsBefore = world.requests;
  const started = performance.now();

  let thrown: unknown;
  try {
    await requestPasswordResetFormAction(form(email));
  } catch (error) {
    thrown = messageOf(error);
  }
  const tookMs = performance.now() - started;

  const lines = boundaryLinesWritten();
  return {
    observable: {
      thrown,
      redirected: [...redirected],
      // Every field but the duration, which is wall-clock time.
      boundary: lines.map((line) => without(line, "durationMs")),
    },
    tookMs,
    loggedMs: lines.map((line) => line.durationMs),
    requestsMade: world.requests - requestsBefore,
  };
}

async function pageAt(destination: string) {
  const url = new URL(destination, "https://3moji.me");
  const { container } = render(
    await ResetPasswordPage({
      searchParams: Promise.resolve(
        Object.fromEntries(url.searchParams.entries()),
      ),
    }),
  );
  const snapshot = {
    html: container.innerHTML,
    status: screen.queryByRole("status")?.textContent ?? null,
    alert: screen.queryByRole("alert")?.textContent ?? null,
  };
  cleanup();
  return snapshot;
}

/** Spend the client's whole allowance on some other address. */
async function exhaust(): Promise<void> {
  for (let attempt = 0; attempt < HTTP_MAX; attempt += 1) {
    await submit(`someone-${String(attempt)}@example.com`);
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

/** A little under the floor, for timer granularity. */
const FLOOR_TOLERANCE_MS = 5;

describe("the password reset request form (#192)", () => {
  jest.setTimeout(30_000);

  it("gives a registered and an unregistered address an identical response, each held to the 500 ms floor", async () => {
    const registered = await submit(REGISTERED);
    const mailedAfterRegistered = [...world.mailed];
    const unregistered = await submit(UNREGISTERED);

    // The two really took different paths: only one address was mailed.
    expect(mailedAfterRegistered).toEqual([REGISTERED]);
    expect(world.mailed).toEqual([REGISTERED]);

    expect(unregistered.observable).toEqual(registered.observable);
    expect(registered.observable).toEqual({
      thrown: "NEXT_REDIRECT",
      redirected: ["/reset-password?notice=sent"],
      boundary: [
        {
          event: "api_boundary",
          boundary: "password-reset.request",
          outcome: "redirected",
          correlationId: "none",
        },
      ],
    });
    for (const outcome of [registered, unregistered]) {
      expect(outcome.tookMs).toBeGreaterThanOrEqual(
        RESPONSE_FLOOR_MS - FLOOR_TOLERANCE_MS,
      );
      expect(outcome.loggedMs[0]).toBeGreaterThanOrEqual(
        RESPONSE_FLOOR_MS - FLOOR_TOLERANCE_MS,
      );
    }

    const [first, second] = [
      await pageAt("/reset-password?notice=sent"),
      await pageAt(
        registered.observable.redirected[0] ?? "/reset-password?notice=?",
      ),
    ];
    expect(second).toEqual(first);
    expect(first.status).toBe(en.PasswordReset.requestSent);
  });

  it("accepts no more requests from one client than Better Auth's HTTP endpoint allows", async () => {
    expect(RESET_REQUEST_CLIENT_RATE_LIMIT.maxPerWindow).toBe(HTTP_MAX);

    const outcomes = [];
    for (let attempt = 0; attempt <= HTTP_MAX; attempt += 1) {
      outcomes.push(await submit(REGISTERED));
    }

    expect(world.requests).toBe(HTTP_MAX);
    expect(world.mailed).toHaveLength(HTTP_MAX);
    expect(outcomes.at(-1)?.observable.redirected).toEqual([
      "/reset-password?notice=rate-limited",
    ]);
    expect(outcomes.at(-1)?.requestsMade).toBe(0);
  });

  it("refuses a registered and an unregistered address identically beyond the limit", async () => {
    const beyond = [];
    for (const email of [REGISTERED, UNREGISTERED]) {
      world = freshWorld();
      await exhaust();
      const outcome = await submit(email);
      const [destination] = outcome.observable.redirected;
      if (destination === undefined) throw new Error("no redirect");
      beyond.push({
        observable: outcome.observable,
        requestsMade: outcome.requestsMade,
        mailed: world.mailed.filter((address) => address === email),
        page: await pageAt(destination),
        floored: outcome.tookMs >= RESPONSE_FLOOR_MS - FLOOR_TOLERANCE_MS,
      });
    }

    expect(beyond[1]).toEqual(beyond[0]);
    expect(beyond[0]).toEqual({
      observable: {
        thrown: "NEXT_REDIRECT",
        redirected: ["/reset-password?notice=rate-limited"],
        boundary: [
          expect.objectContaining({
            boundary: "password-reset.request",
            outcome: "rate-limited",
          }),
        ],
      },
      requestsMade: 0,
      mailed: [],
      page: expect.objectContaining({
        alert: en.PasswordReset.requestRateLimited,
      }) as unknown,
      floored: true,
    });
  });

  it("does not limit a different client", async () => {
    await exhaust();
    world.clientAddress = "198.51.100.9";

    expect((await submit(REGISTERED)).observable.redirected).toEqual([
      "/reset-password?notice=sent",
    ]);
  });

  it("limits requests with no readable address in one shared bucket, rather than not at all", async () => {
    world.clientAddress = undefined;
    await exhaust();

    expect((await submit(REGISTERED)).observable.redirected).toEqual([
      "/reset-password?notice=rate-limited",
    ]);
  });

  it("fails closed when the limiter's store cannot count, logging it without the address", async () => {
    world.storeFails = true;

    const outcome = await submit(REGISTERED);

    expect(outcome.observable.redirected).toEqual([
      "/reset-password?notice=failed",
    ]);
    expect(outcome.requestsMade).toBe(0);
    const everything = written.join("\n");
    expect(everything).toContain("password_reset_request_failed");
    expect(everything).toContain("ECONNREFUSED");
    expect(everything).not.toContain(REGISTERED);
    expect(everything).not.toContain(CLIENT);
    expect(outcome.observable.boundary).toEqual([
      expect.objectContaining({ outcome: "failed" }),
    ]);
  });
});
