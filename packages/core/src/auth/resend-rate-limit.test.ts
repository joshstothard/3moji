import { createInMemoryClaimRateLimitStore } from "../adapters/in-memory-claim-rate-limit-store";
import {
  CLAIM_RATE_LIMITS,
  RATE_LIMIT_RETENTION_MS,
  claimRateLimitBuckets,
  createClaimRateLimiter,
} from "../handle/claim-rate-limit";
import type {
  ClaimRateLimitHit,
  ClaimRateLimitStore,
} from "../ports/claim-rate-limit-store";
import type { Clock } from "../ports/clock";
import {
  RESEND_CLIENT_RATE_LIMIT,
  createResendClientRateLimiter,
  resendClientBucket,
} from "./resend-rate-limit";

const HOUR = 60 * 60 * 1000;
const MINUTE = 60 * 1000;
const SECRET = "s".repeat(32);
/** Twenty minutes into its hour, so the refusal's "when" is forty minutes. */
const NOW = new Date("2026-09-13T12:20:00.000Z");

const movableClock = (): { clock: Clock; advance: (ms: number) => void } => {
  let now = NOW.getTime();
  return {
    clock: { now: () => new Date(now) },
    advance: (ms) => {
      now += ms;
    },
  };
};

describe("RESEND_CLIENT_RATE_LIMIT", () => {
  it("starts at ten an hour per client address", () => {
    // Spelled out, so tuning it is a deliberate edit (#158).
    expect(RESEND_CLIENT_RATE_LIMIT).toEqual({
      maxPerWindow: 10,
      windowMs: HOUR,
    });
  });

  it("fits inside the retention every limiter on the shared table prunes by", () => {
    // Every limiter over `claim_rate_limit` deletes windows older than the
    // retention. A window longer than it would have its own live rows deleted
    // by a Claim, and the limit would quietly fail open.
    expect(RESEND_CLIENT_RATE_LIMIT.windowMs).toBeLessThanOrEqual(
      RATE_LIMIT_RETENTION_MS,
    );
    expect(CLAIM_RATE_LIMITS.perClientAddress.windowMs).toBeLessThanOrEqual(
      RATE_LIMIT_RETENTION_MS,
    );
    expect(CLAIM_RATE_LIMITS.perEmailAddress.windowMs).toBeLessThanOrEqual(
      RATE_LIMIT_RETENTION_MS,
    );
  });
});

describe("resendClientBucket", () => {
  it("is a keyed hash under its own kind, never the address", () => {
    const bucket = resendClientBucket(SECRET, "203.0.113.7");

    expect(bucket).toMatch(/^resend-client:[0-9a-f]{64}$/);
    expect(bucket).not.toContain("203.0.113.7");
  });

  it("never shares a counter with the Claim's client-address limit", () => {
    const claim = claimRateLimitBuckets({
      secret: SECRET,
      clientAddress: "203.0.113.7",
      email: "someone@example.com",
    });

    expect(resendClientBucket(SECRET, "203.0.113.7")).not.toBe(claim.client);
    expect(resendClientBucket(SECRET, "203.0.113.7").slice(-64)).not.toBe(
      claim.client.slice(-64),
    );
  });

  it("groups clients the way the Claim's limit does", () => {
    // IPv6 by /64, IPv4-mapped as IPv4, and anything unreadable in one bucket.
    expect(resendClientBucket(SECRET, "2001:db8:1:2::1")).toBe(
      resendClientBucket(SECRET, "2001:db8:1:2:ffff::9"),
    );
    expect(resendClientBucket(SECRET, "::ffff:203.0.113.7")).toBe(
      resendClientBucket(SECRET, "203.0.113.7"),
    );
    expect(resendClientBucket(SECRET, undefined)).toBe(
      resendClientBucket(SECRET, "not an address"),
    );
  });

  it("depends on the secret, so a guessed address cannot be confirmed without it", () => {
    expect(resendClientBucket(SECRET, "203.0.113.7")).not.toBe(
      resendClientBucket("t".repeat(32), "203.0.113.7"),
    );
  });
});

describe("createResendClientRateLimiter", () => {
  it("admits ten requests from one client in an hour and refuses the eleventh, saying when", async () => {
    const { clock } = movableClock();
    const limiter = createResendClientRateLimiter({
      store: createInMemoryClaimRateLimitStore(),
      clock,
      secret: SECRET,
    });

    const admitted: string[] = [];
    for (let request = 0; request < 10; request += 1) {
      admitted.push((await limiter.admit("203.0.113.7")).state);
    }

    expect(admitted).toEqual(Array<string>(10).fill("admitted"));
    expect(await limiter.admit("203.0.113.7")).toEqual({
      state: "rate-limited",
      retryAfterMs: 40 * MINUTE,
    });
  });

  it("does not limit a different client", async () => {
    const { clock } = movableClock();
    const limiter = createResendClientRateLimiter({
      store: createInMemoryClaimRateLimitStore(),
      clock,
      secret: SECRET,
      limit: { maxPerWindow: 1, windowMs: HOUR },
    });

    await limiter.admit("203.0.113.7");

    expect((await limiter.admit("198.51.100.1")).state).toBe("admitted");
    expect((await limiter.admit("203.0.113.7")).state).toBe("rate-limited");
  });

  it("admits again once the window has ended", async () => {
    const { clock, advance } = movableClock();
    const limiter = createResendClientRateLimiter({
      store: createInMemoryClaimRateLimitStore(),
      clock,
      secret: SECRET,
      limit: { maxPerWindow: 1, windowMs: HOUR },
    });

    await limiter.admit("203.0.113.7");
    advance(40 * MINUTE);

    expect((await limiter.admit("203.0.113.7")).state).toBe("admitted");
  });

  it("prunes by the shared retention, so it never deletes a Claim's live counter", async () => {
    const { clock } = movableClock();
    const store = createInMemoryClaimRateLimitStore();
    const claims = createClaimRateLimiter({ store, clock, secret: SECRET });
    const resends = createResendClientRateLimiter({
      store,
      clock,
      secret: SECRET,
      // A shorter window than the Claim's: pruning by its own window would
      // delete the Claim's current hour.
      limit: { maxPerWindow: 10, windowMs: 10 * MINUTE },
    });

    await claims.admit({ clientAddress: "203.0.113.7", email: "a@b.com" });
    const before = new Map(store.rows);
    await resends.admit("203.0.113.7");

    for (const [row, count] of before) {
      expect(store.rows.get(row)).toBe(count);
    }
  });

  it("asks the store to forget only windows older than the retention", async () => {
    const { clock } = movableClock();
    const forgotten: Date[] = [];
    const store: ClaimRateLimitStore = {
      record: (hits: readonly ClaimRateLimitHit[], forgetBefore: Date) => {
        forgotten.push(forgetBefore);
        return Promise.resolve(hits.map(() => 1));
      },
    };

    await createResendClientRateLimiter({
      store,
      clock,
      secret: SECRET,
      limit: { maxPerWindow: 10, windowMs: 10 * MINUTE },
    }).admit("203.0.113.7");

    expect(forgotten).toEqual([
      new Date(NOW.getTime() - RATE_LIMIT_RETENTION_MS),
    ]);
  });

  it("rejects when the store cannot count, so the caller fails closed", async () => {
    const limiter = createResendClientRateLimiter({
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

  it("refuses to be built without the secret its buckets are keyed on", () => {
    expect(() =>
      createResendClientRateLimiter({
        store: createInMemoryClaimRateLimitStore(),
        clock: movableClock().clock,
        secret: "",
      }),
    ).toThrow(/secret/);
  });
});
