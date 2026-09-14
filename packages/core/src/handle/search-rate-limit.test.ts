import { createInMemoryClaimRateLimitStore } from "../adapters/in-memory-claim-rate-limit-store";
import { resendClientBucket } from "../auth/resend-rate-limit";
import { signInClientBucket } from "../auth/sign-in-rate-limit";
import type {
  ClaimRateLimitHit,
  ClaimRateLimitStore,
} from "../ports/claim-rate-limit-store";
import type { Clock } from "../ports/clock";
import {
  RATE_LIMIT_RETENTION_MS,
  claimRateLimitBuckets,
  createClaimRateLimiter,
} from "./claim-rate-limit";
import {
  SEARCH_CLIENT_RATE_LIMIT,
  createSearchClientRateLimiter,
  searchClientBucket,
} from "./search-rate-limit";

/**
 * The header search's per-client-address limit
 * ([ADR-0012](../../../../docs/adr/0012-header-search-lists-claimed-handles-with-display-names-capped-and-rate-limited.md)
 * decision 6): 60 requests per client address per fixed 10-minute window, on
 * `claim_rate_limit` under the `search-client:` bucket kind, with the other
 * limiters' keyed hash and client-address grouping.
 */

const MINUTE = 60 * 1000;
const SECRET = "s".repeat(32);
/** Four minutes into a ten-minute window. */
const NOW = new Date("2026-09-14T12:04:00.000Z");

const movableClock = (): { clock: Clock; advance: (ms: number) => void } => {
  let now = NOW.getTime();
  return {
    clock: { now: () => new Date(now) },
    advance: (ms) => {
      now += ms;
    },
  };
};

describe("SEARCH_CLIENT_RATE_LIMIT", () => {
  it("is sixty requests per client address in a fixed ten minutes", () => {
    expect(SEARCH_CLIENT_RATE_LIMIT).toEqual({
      maxPerWindow: 60,
      windowMs: 10 * MINUTE,
    });
  });

  it("fits inside the retention every limiter on the shared table prunes by", () => {
    expect(SEARCH_CLIENT_RATE_LIMIT.windowMs).toBeGreaterThan(0);
    expect(SEARCH_CLIENT_RATE_LIMIT.windowMs).toBeLessThanOrEqual(
      RATE_LIMIT_RETENTION_MS,
    );
  });
});

describe("searchClientBucket", () => {
  it("is a keyed hash under its own kind, never the address", () => {
    const bucket = searchClientBucket(SECRET, "203.0.113.7");

    expect(bucket).toMatch(/^search-client:[0-9a-f]{64}$/);
    expect(bucket).not.toContain("203.0.113.7");
  });

  it("never shares a counter with another limiter's client bucket", () => {
    const search = searchClientBucket(SECRET, "203.0.113.7").slice(-64);

    expect(search).not.toBe(
      claimRateLimitBuckets({
        secret: SECRET,
        clientAddress: "203.0.113.7",
        email: "someone@example.com",
      }).client.slice(-64),
    );
    expect(search).not.toBe(
      signInClientBucket(SECRET, "203.0.113.7").slice(-64),
    );
    expect(search).not.toBe(
      resendClientBucket(SECRET, "203.0.113.7").slice(-64),
    );
  });

  it("groups clients the way the other limits do", () => {
    expect(searchClientBucket(SECRET, "2001:db8:1:2::1")).toBe(
      searchClientBucket(SECRET, "2001:db8:1:2:ffff::9"),
    );
    expect(searchClientBucket(SECRET, "::ffff:203.0.113.7")).toBe(
      searchClientBucket(SECRET, "203.0.113.7"),
    );
    expect(searchClientBucket(SECRET, undefined)).toBe(
      searchClientBucket(SECRET, "not an address"),
    );
  });

  it("depends on the secret", () => {
    expect(searchClientBucket(SECRET, "203.0.113.7")).not.toBe(
      searchClientBucket("t".repeat(32), "203.0.113.7"),
    );
  });
});

describe("createSearchClientRateLimiter", () => {
  it("admits sixty searches from one client in its window and refuses the sixty-first", async () => {
    const limiter = createSearchClientRateLimiter({
      store: createInMemoryClaimRateLimitStore(),
      clock: movableClock().clock,
      secret: SECRET,
    });

    const states: string[] = [];
    for (let request = 0; request < 61; request += 1) {
      states.push((await limiter.admit("203.0.113.7")).state);
    }

    expect(states).toEqual([
      ...Array<string>(60).fill("admitted"),
      "rate-limited",
    ]);
  });

  it("says nothing but rate-limited: no field about when", async () => {
    const limiter = createSearchClientRateLimiter({
      store: createInMemoryClaimRateLimitStore(),
      clock: movableClock().clock,
      secret: SECRET,
      limit: { maxPerWindow: 1, windowMs: 10 * MINUTE },
    });

    await limiter.admit("203.0.113.7");

    expect(await limiter.admit("203.0.113.7")).toEqual({
      state: "rate-limited",
    });
  });

  it("does not limit a different client, and admits again in the next fixed window", async () => {
    const { clock, advance } = movableClock();
    const limiter = createSearchClientRateLimiter({
      store: createInMemoryClaimRateLimitStore(),
      clock,
      secret: SECRET,
      limit: { maxPerWindow: 1, windowMs: 10 * MINUTE },
    });

    await limiter.admit("203.0.113.7");
    expect((await limiter.admit("198.51.100.1")).state).toBe("admitted");
    advance(5 * MINUTE);
    expect((await limiter.admit("203.0.113.7")).state).toBe("rate-limited");

    // 12:04 + 6 minutes is 12:10, the start of the next fixed window.
    advance(MINUTE);
    expect((await limiter.admit("203.0.113.7")).state).toBe("admitted");
  });

  it("records its own bucket and window, pruning only by the shared retention", async () => {
    const forgotten: Date[] = [];
    const recorded: ClaimRateLimitHit[] = [];
    const store: ClaimRateLimitStore = {
      record: (hits, forgetBefore) => {
        forgotten.push(forgetBefore);
        recorded.push(...hits);
        return Promise.resolve(hits.map(() => 1));
      },
    };

    await createSearchClientRateLimiter({
      store,
      clock: movableClock().clock,
      secret: SECRET,
    }).admit("203.0.113.7");

    expect(forgotten).toEqual([
      new Date(NOW.getTime() - RATE_LIMIT_RETENTION_MS),
    ]);
    expect(recorded).toEqual([
      {
        bucket: searchClientBucket(SECRET, "203.0.113.7"),
        windowStart: new Date("2026-09-14T12:00:00.000Z"),
      },
    ]);
  });

  it("leaves a Claim's live counter on the shared store alone", async () => {
    const { clock } = movableClock();
    const store = createInMemoryClaimRateLimitStore();
    const claims = createClaimRateLimiter({ store, clock, secret: SECRET });
    const searches = createSearchClientRateLimiter({
      store,
      clock,
      secret: SECRET,
    });

    await claims.admit({ clientAddress: "203.0.113.7", email: "a@b.com" });
    const before = new Map(store.rows);
    await searches.admit("203.0.113.7");

    for (const [row, count] of before) {
      expect(store.rows.get(row)).toBe(count);
    }
    expect(store.rows.size).toBe(before.size + 1);
  });

  it("rejects when the store cannot count, or answers no count, so the route fails closed", async () => {
    const unreachable = createSearchClientRateLimiter({
      store: {
        record: () => Promise.reject(new Error("database unreachable")),
      },
      clock: movableClock().clock,
      secret: SECRET,
    });
    const silent = createSearchClientRateLimiter({
      store: { record: () => Promise.resolve([]) },
      clock: movableClock().clock,
      secret: SECRET,
    });

    await expect(unreachable.admit("203.0.113.7")).rejects.toThrow(
      "database unreachable",
    );
    await expect(silent.admit("203.0.113.7")).rejects.toThrow(/no count/);
  });

  it("refuses to be built without the secret its buckets are keyed on", () => {
    expect(() =>
      createSearchClientRateLimiter({
        store: createInMemoryClaimRateLimitStore(),
        clock: movableClock().clock,
        secret: "",
      }),
    ).toThrow(/secret/);
  });
});
