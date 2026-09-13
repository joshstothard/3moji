import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import { createDrizzleClaimRateLimitStore } from "../adapters/drizzle-claim-rate-limit-store";
import { createInMemoryClaimRateLimitStore } from "../adapters/in-memory-claim-rate-limit-store";
import {
  RATE_LIMIT_RETENTION_MS,
  claimRateLimitBuckets,
  createClaimRateLimiter,
} from "../handle/claim-rate-limit";
import type {
  ClaimRateLimitHit,
  ClaimRateLimitStore,
} from "../ports/claim-rate-limit-store";
import type { Clock } from "../ports/clock";
import { authSchema } from "../db/schema";
import { AUTH_RATE_LIMITS } from "./auth-rate-limit";
import { resendClientBucket } from "./resend-rate-limit";
import {
  SIGN_IN_CLIENT_RATE_LIMIT,
  createSignInClientRateLimiter,
  signInClientBucket,
} from "./sign-in-rate-limit";

const MINUTE = 60 * 1000;
const SECRET = "s".repeat(32);
/** Five minutes into a fifteen-minute window. */
const NOW = new Date("2026-09-13T12:05:00.000Z");

const movableClock = (): { clock: Clock; advance: (ms: number) => void } => {
  let now = NOW.getTime();
  return {
    clock: { now: () => new Date(now) },
    advance: (ms) => {
      now += ms;
    },
  };
};

describe("SIGN_IN_CLIENT_RATE_LIMIT", () => {
  it("starts at ten per client address in fifteen minutes", () => {
    // Spelled out, so tuning it is a deliberate edit (#180).
    expect(SIGN_IN_CLIENT_RATE_LIMIT).toEqual({
      maxPerWindow: 10,
      windowMs: 15 * MINUTE,
    });
  });

  it("matches Better Auth's HTTP sign-in limit, so the form and the endpoint cannot drift apart", () => {
    // `AUTH_RATE_LIMITS` windows are Better Auth's seconds; ours are ms.
    expect(SIGN_IN_CLIENT_RATE_LIMIT.maxPerWindow).toBe(
      AUTH_RATE_LIMITS.signInEmail.max,
    );
    expect(SIGN_IN_CLIENT_RATE_LIMIT.windowMs).toBe(
      AUTH_RATE_LIMITS.signInEmail.window * 1000,
    );
  });

  it("fits inside the retention every limiter on the shared table prunes by", () => {
    expect(SIGN_IN_CLIENT_RATE_LIMIT.windowMs).toBeGreaterThan(0);
    expect(SIGN_IN_CLIENT_RATE_LIMIT.windowMs).toBeLessThanOrEqual(
      RATE_LIMIT_RETENTION_MS,
    );
  });
});

describe("signInClientBucket", () => {
  it("is a keyed hash under its own kind, never the address", () => {
    const bucket = signInClientBucket(SECRET, "203.0.113.7");

    expect(bucket).toMatch(/^sign-in-client:[0-9a-f]{64}$/);
    expect(bucket).not.toContain("203.0.113.7");
  });

  it("never shares a counter with the Claim's or resend's client limits", () => {
    const claim = claimRateLimitBuckets({
      secret: SECRET,
      clientAddress: "203.0.113.7",
      email: "someone@example.com",
    });
    const signIn = signInClientBucket(SECRET, "203.0.113.7");

    expect(signIn.slice(-64)).not.toBe(claim.client.slice(-64));
    expect(signIn.slice(-64)).not.toBe(
      resendClientBucket(SECRET, "203.0.113.7").slice(-64),
    );
  });

  it("groups clients the way the Claim's and resend's limits do", () => {
    expect(signInClientBucket(SECRET, "2001:db8:1:2::1")).toBe(
      signInClientBucket(SECRET, "2001:db8:1:2:ffff::9"),
    );
    expect(signInClientBucket(SECRET, "2001:db8:1:2::1")).not.toBe(
      signInClientBucket(SECRET, "2001:db8:1:3::1"),
    );
    expect(signInClientBucket(SECRET, "::ffff:203.0.113.7")).toBe(
      signInClientBucket(SECRET, "203.0.113.7"),
    );
    expect(signInClientBucket(SECRET, undefined)).toBe(
      signInClientBucket(SECRET, "not an address"),
    );
  });

  it("depends on the secret, so a guessed address cannot be confirmed without it", () => {
    expect(signInClientBucket(SECRET, "203.0.113.7")).not.toBe(
      signInClientBucket("t".repeat(32), "203.0.113.7"),
    );
  });
});

describe("createSignInClientRateLimiter", () => {
  it("admits ten sign-ins from one client in its window and refuses the eleventh", async () => {
    const limiter = createSignInClientRateLimiter({
      store: createInMemoryClaimRateLimitStore(),
      clock: movableClock().clock,
      secret: SECRET,
    });

    const states: string[] = [];
    for (let attempt = 0; attempt < 11; attempt += 1) {
      states.push((await limiter.admit("203.0.113.7")).state);
    }

    expect(states).toEqual([
      ...Array<string>(10).fill("admitted"),
      "rate-limited",
    ]);
  });

  it("says nothing but rate-limited: no field about when, or about whom", async () => {
    const limiter = createSignInClientRateLimiter({
      store: createInMemoryClaimRateLimitStore(),
      clock: movableClock().clock,
      secret: SECRET,
      limit: { maxPerWindow: 1, windowMs: 15 * MINUTE },
    });

    await limiter.admit("203.0.113.7");

    expect(await limiter.admit("203.0.113.7")).toEqual({
      state: "rate-limited",
    });
  });

  it("does not limit a different client", async () => {
    const limiter = createSignInClientRateLimiter({
      store: createInMemoryClaimRateLimitStore(),
      clock: movableClock().clock,
      secret: SECRET,
      limit: { maxPerWindow: 1, windowMs: 15 * MINUTE },
    });

    await limiter.admit("203.0.113.7");

    expect((await limiter.admit("198.51.100.1")).state).toBe("admitted");
    expect((await limiter.admit("203.0.113.7")).state).toBe("rate-limited");
  });

  it("admits again once the fixed window has ended", async () => {
    const { clock, advance } = movableClock();
    const limiter = createSignInClientRateLimiter({
      store: createInMemoryClaimRateLimitStore(),
      clock,
      secret: SECRET,
      limit: { maxPerWindow: 1, windowMs: 15 * MINUTE },
    });

    await limiter.admit("203.0.113.7");
    advance(9 * MINUTE);
    expect((await limiter.admit("203.0.113.7")).state).toBe("rate-limited");

    // 12:05 + 10 minutes is 12:15, the start of the next fixed window.
    advance(MINUTE);
    expect((await limiter.admit("203.0.113.7")).state).toBe("admitted");
  });

  it("counts on the Claim's store under its own bucket, leaving a Claim's live counter alone", async () => {
    const { clock } = movableClock();
    const store = createInMemoryClaimRateLimitStore();
    const claims = createClaimRateLimiter({ store, clock, secret: SECRET });
    const signIns = createSignInClientRateLimiter({
      store,
      clock,
      secret: SECRET,
    });

    await claims.admit({ clientAddress: "203.0.113.7", email: "a@b.com" });
    const before = new Map(store.rows);
    await signIns.admit("203.0.113.7");

    for (const [row, count] of before) {
      expect(store.rows.get(row)).toBe(count);
    }
    expect(store.rows.size).toBe(before.size + 1);
  });

  it("asks the store to forget only windows older than the shared retention, never its own shorter window", async () => {
    const forgotten: Date[] = [];
    const recorded: ClaimRateLimitHit[] = [];
    const store: ClaimRateLimitStore = {
      record: (hits, forgetBefore) => {
        forgotten.push(forgetBefore);
        recorded.push(...hits);
        return Promise.resolve(hits.map(() => 1));
      },
    };

    await createSignInClientRateLimiter({
      store,
      clock: movableClock().clock,
      secret: SECRET,
    }).admit("203.0.113.7");

    expect(forgotten).toEqual([
      new Date(NOW.getTime() - RATE_LIMIT_RETENTION_MS),
    ]);
    expect(recorded).toEqual([
      {
        bucket: signInClientBucket(SECRET, "203.0.113.7"),
        windowStart: new Date("2026-09-13T12:00:00.000Z"),
      },
    ]);
  });

  it("rejects when the store cannot count, so the caller fails closed", async () => {
    const limiter = createSignInClientRateLimiter({
      store: {
        record: () => Promise.reject(new Error("database unreachable")),
      },
      clock: movableClock().clock,
      secret: SECRET,
    });

    await expect(limiter.admit("203.0.113.7")).rejects.toThrow(
      "database unreachable",
    );
  });

  it("rejects through the real adapter as DatabaseQueryFailed, with a code and no bound values, when the database cannot be reached", async () => {
    // A closed port, so no database is needed: the statement never reaches a
    // server, and the adapter must still strip what it bound (#144).
    const closed = new Pool({
      host: "127.0.0.1",
      port: 59999,
      connectionTimeoutMillis: 2000,
    });
    const limiter = createSignInClientRateLimiter({
      store: createDrizzleClaimRateLimitStore({
        db: drizzle(closed, { schema: authSchema }),
      }),
      clock: movableClock().clock,
      secret: SECRET,
    });

    let caught: unknown;
    try {
      await limiter.admit("203.0.113.7");
    } catch (error) {
      caught = error;
    } finally {
      await closed.end();
    }

    const fields =
      typeof caught === "object" && caught !== null
        ? {
            name: "name" in caught ? caught.name : undefined,
            code: "code" in caught ? caught.code : undefined,
            cause: "cause" in caught ? caught.cause : undefined,
          }
        : { name: undefined, code: undefined, cause: undefined };
    expect(fields).toEqual({
      name: "DatabaseQueryFailed",
      code: "ECONNREFUSED",
      cause: undefined,
    });
    const said = `${String(caught)} ${JSON.stringify(caught)}`;
    expect(said).not.toContain(
      signInClientBucket(SECRET, "203.0.113.7").slice(-64),
    );
    expect(said).not.toContain("203.0.113.7");
  });

  it("rejects when the store answers with no count", async () => {
    const limiter = createSignInClientRateLimiter({
      store: { record: () => Promise.resolve([]) },
      clock: movableClock().clock,
      secret: SECRET,
    });

    await expect(limiter.admit("203.0.113.7")).rejects.toThrow(/no count/);
  });

  it("refuses to be built without the secret its buckets are keyed on", () => {
    expect(() =>
      createSignInClientRateLimiter({
        store: createInMemoryClaimRateLimitStore(),
        clock: movableClock().clock,
        secret: "",
      }),
    ).toThrow(/secret/);
  });
});
