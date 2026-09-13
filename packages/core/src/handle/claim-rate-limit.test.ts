import { createInMemoryClaimRateLimitStore } from "../adapters/in-memory-claim-rate-limit-store";
import type {
  ClaimRateLimitHit,
  ClaimRateLimitStore,
} from "../ports/claim-rate-limit-store";
import type { Clock } from "../ports/clock";
import {
  CLAIM_RATE_LIMITS,
  claimAdmission,
  claimRateLimitBuckets,
  clientAddressBucket,
  createClaimRateLimiter,
  windowStartOf,
  type ClaimRateLimits,
} from "./claim-rate-limit";

const HOUR = 60 * 60 * 1000;
const SECRET = "s".repeat(32);
const NOW = new Date("2026-09-13T12:34:56.789Z");

const movableClock = (): { clock: Clock; advance: (ms: number) => void } => {
  let now = NOW.getTime();
  return {
    clock: { now: () => new Date(now) },
    advance: (ms) => {
      now += ms;
    },
  };
};

describe("CLAIM_RATE_LIMITS", () => {
  it("starts at ten an hour per client address and three an hour per email address", () => {
    // Spelled out rather than derived: tuning a limit is meant to be a
    // deliberate edit, and this is the test that makes it one.
    expect(CLAIM_RATE_LIMITS).toEqual({
      perClientAddress: { maxPerWindow: 10, windowMs: HOUR },
      perEmailAddress: { maxPerWindow: 3, windowMs: HOUR },
    });
  });
});

describe("claimAdmission", () => {
  const limits: ClaimRateLimits = {
    perClientAddress: { maxPerWindow: 4, windowMs: HOUR },
    perEmailAddress: { maxPerWindow: 2, windowMs: HOUR },
  };

  it("admits a submission that brings a bucket exactly to its limit", () => {
    expect(claimAdmission({ clientCount: 4, emailCount: 2, limits })).toBe(
      "admitted",
    );
  });

  it("refuses the first submission past the client address limit", () => {
    expect(claimAdmission({ clientCount: 5, emailCount: 1, limits })).toBe(
      "rate-limited",
    );
  });

  it("refuses the first submission past the email address limit", () => {
    expect(claimAdmission({ clientCount: 1, emailCount: 3, limits })).toBe(
      "rate-limited",
    );
  });

  it("gives one answer whichever limit binds, or both", () => {
    const clientOnly = claimAdmission({
      clientCount: 5,
      emailCount: 1,
      limits,
    });
    const emailOnly = claimAdmission({ clientCount: 1, emailCount: 3, limits });
    const both = claimAdmission({ clientCount: 5, emailCount: 3, limits });

    expect(emailOnly).toEqual(clientOnly);
    expect(both).toEqual(clientOnly);
  });

  it("uses the shipped limits when none are given", () => {
    expect(claimAdmission({ clientCount: 10, emailCount: 3 })).toBe("admitted");
    expect(claimAdmission({ clientCount: 11, emailCount: 3 })).toBe(
      "rate-limited",
    );
    expect(claimAdmission({ clientCount: 10, emailCount: 4 })).toBe(
      "rate-limited",
    );
  });
});

describe("windowStartOf", () => {
  it("floors a time to the start of its window", () => {
    expect(windowStartOf(NOW, HOUR).toISOString()).toBe(
      "2026-09-13T12:00:00.000Z",
    );
  });

  it("puts the first millisecond of a window in that window, not the last", () => {
    const boundary = new Date("2026-09-13T13:00:00.000Z");
    expect(windowStartOf(boundary, HOUR)).toEqual(boundary);
    expect(
      windowStartOf(new Date(boundary.getTime() - 1), HOUR).toISOString(),
    ).toBe("2026-09-13T12:00:00.000Z");
  });
});

describe("clientAddressBucket", () => {
  it("keeps an IPv4 address whole", () => {
    expect(clientAddressBucket("203.0.113.7")).toBe("ipv4:203.0.113.7");
  });

  it("puts every address in one IPv6 /64 in one bucket, since one subscriber holds the whole /64", () => {
    expect(clientAddressBucket("2001:db8:1:2:aaaa:bbbb:cccc:dddd")).toBe(
      "ipv6:2001:db8:1:2::/64",
    );
    expect(clientAddressBucket("2001:db8:1:2::1")).toBe(
      "ipv6:2001:db8:1:2::/64",
    );
    expect(clientAddressBucket("2001:DB8:1:2:0:0:0:ffff")).toBe(
      "ipv6:2001:db8:1:2::/64",
    );
  });

  it("separates neighbouring /64s", () => {
    expect(clientAddressBucket("2001:db8:1:3::1")).not.toBe(
      clientAddressBucket("2001:db8:1:2::1"),
    );
  });

  it("expands a compressed prefix", () => {
    expect(clientAddressBucket("::1")).toBe("ipv6:0:0:0:0::/64");
    expect(clientAddressBucket("2001:db8::")).toBe("ipv6:2001:db8:0:0::/64");
    expect(clientAddressBucket("fe80::1%eth0")).toBe("ipv6:fe80:0:0:0::/64");
  });

  it("treats an IPv4-mapped IPv6 address as the IPv4 address it carries", () => {
    expect(clientAddressBucket("::ffff:203.0.113.7")).toBe("ipv4:203.0.113.7");
  });

  it("trims whitespace a header may carry", () => {
    expect(clientAddressBucket("  203.0.113.7 ")).toBe("ipv4:203.0.113.7");
  });

  it.each([
    ["missing", undefined],
    ["empty", ""],
    ["not an address", "localhost"],
    ["an out-of-range octet", "999.0.113.7"],
    ["a list rather than one address", "203.0.113.7, 198.51.100.1"],
    ["an address with a port", "203.0.113.7:443"],
  ])("puts a %s address in the one shared unknown bucket", (_label, raw) => {
    expect(clientAddressBucket(raw)).toBe("unknown");
  });
});

describe("claimRateLimitBuckets", () => {
  const EMAIL = "someone@example.com";
  const ADDRESS = "203.0.113.7";

  it("never stores the address itself, only a keyed hash of it", () => {
    const buckets = claimRateLimitBuckets({
      secret: SECRET,
      clientAddress: ADDRESS,
      email: EMAIL,
    });

    expect(buckets.email).toMatch(/^email:[0-9a-f]{64}$/);
    expect(buckets.client).toMatch(/^client:[0-9a-f]{64}$/);
    expect(JSON.stringify(buckets)).not.toContain("someone");
    expect(JSON.stringify(buckets)).not.toContain("example");
    expect(JSON.stringify(buckets)).not.toContain("203.0");
  });

  it("gives one address one bucket however it was typed (#163)", () => {
    const typed = claimRateLimitBuckets({
      secret: SECRET,
      clientAddress: ADDRESS,
      email: "  Someone@Example.COM ",
    });
    const normal = claimRateLimitBuckets({
      secret: SECRET,
      clientAddress: ADDRESS,
      email: EMAIL,
    });

    expect(typed.email).toBe(normal.email);
  });

  it("is keyed: another secret gives unrelated buckets, so a guess cannot be confirmed without it", () => {
    const one = claimRateLimitBuckets({
      secret: SECRET,
      clientAddress: ADDRESS,
      email: EMAIL,
    });
    const other = claimRateLimitBuckets({
      secret: "t".repeat(32),
      clientAddress: ADDRESS,
      email: EMAIL,
    });

    expect(other.email).not.toBe(one.email);
    expect(other.client).not.toBe(one.client);
  });

  it("keeps a client bucket and an email bucket apart even for the same text", () => {
    const buckets = claimRateLimitBuckets({
      secret: SECRET,
      clientAddress: "unknown",
      email: "unknown",
    });

    expect(buckets.client.slice("client:".length)).not.toBe(
      buckets.email.slice("email:".length),
    );
  });
});

describe("createClaimRateLimiter", () => {
  const build = (
    store: ClaimRateLimitStore = createInMemoryClaimRateLimitStore(),
  ) => {
    const { clock, advance } = movableClock();
    const limiter = createClaimRateLimiter({ store, clock, secret: SECRET });
    return { limiter, advance };
  };

  const submitTimes = async (
    admit: () => Promise<string>,
    times: number,
  ): Promise<string[]> => {
    const answers: string[] = [];
    for (let index = 0; index < times; index += 1) {
      answers.push(await admit());
    }
    return answers;
  };

  it("admits three submissions naming one email address in an hour, then refuses", async () => {
    const { limiter } = build();
    let address = 0;

    const answers = await submitTimes(() => {
      address += 1;
      return limiter.admit({
        clientAddress: `203.0.113.${String(address)}`,
        email: "someone@example.com",
      });
    }, 5);

    expect(answers).toEqual([
      "admitted",
      "admitted",
      "admitted",
      "rate-limited",
      "rate-limited",
    ]);
  });

  it("counts an address typed in different cases as one address", async () => {
    const { limiter } = build();
    const typings = [
      "Someone@Example.com",
      "someone@example.com",
      "SOMEONE@EXAMPLE.COM ",
      "someone@Example.com",
    ];

    const answers: string[] = [];
    for (const [index, email] of typings.entries()) {
      answers.push(
        await limiter.admit({
          clientAddress: `203.0.113.${String(index)}`,
          email,
        }),
      );
    }

    expect(answers).toEqual([
      "admitted",
      "admitted",
      "admitted",
      "rate-limited",
    ]);
  });

  it("admits ten submissions from one client address in an hour, then refuses", async () => {
    const { limiter } = build();
    let email = 0;

    const answers = await submitTimes(() => {
      email += 1;
      return limiter.admit({
        clientAddress: "203.0.113.7",
        email: `person-${String(email)}@example.com`,
      });
    }, 11);

    expect(answers.slice(0, 10)).toEqual(Array(10).fill("admitted"));
    expect(answers[10]).toBe("rate-limited");
  });

  it("reads the window from the injected clock, so the next window starts fresh", async () => {
    const { limiter, advance } = build();
    const submission = {
      clientAddress: "203.0.113.7",
      email: "someone@example.com",
    };

    await submitTimes(() => limiter.admit(submission), 3);
    expect(await limiter.admit(submission)).toBe("rate-limited");

    advance(HOUR);

    expect(await limiter.admit(submission)).toBe("admitted");
  });

  it("puts clients with no readable address in one shared bucket", async () => {
    const { limiter } = build();
    let email = 0;

    const answers = await submitTimes(() => {
      email += 1;
      // Missing and malformed alike: neither can be told apart from the other.
      return limiter.admit({
        clientAddress: email % 2 === 0 ? undefined : "not-an-address",
        email: `person-${String(email)}@example.com`,
      });
    }, 11);

    expect(answers[10]).toBe("rate-limited");
  });

  it("records both buckets on every submission, in one call, whichever would bind", async () => {
    const calls: { hits: readonly ClaimRateLimitHit[]; forgetBefore: Date }[] =
      [];
    const inner = createInMemoryClaimRateLimitStore();
    const store: ClaimRateLimitStore = {
      record: (hits, forgetBefore) => {
        calls.push({ hits, forgetBefore });
        return inner.record(hits, forgetBefore);
      },
    };
    const { limiter } = build(store);

    await limiter.admit({
      clientAddress: "203.0.113.7",
      email: "someone@example.com",
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.hits.map((hit) => hit.bucket.split(":")[0])).toEqual([
      "client",
      "email",
    ]);
    expect(calls[0]?.hits.map((hit) => hit.windowStart.toISOString())).toEqual([
      "2026-09-13T12:00:00.000Z",
      "2026-09-13T12:00:00.000Z",
    ]);
    // Nothing older than the longest window is kept.
    expect(calls[0]?.forgetBefore.toISOString()).toBe(
      "2026-09-13T11:34:56.789Z",
    );
  });

  it("rejects when the store cannot count, so the Claim fails closed", async () => {
    const failure = new Error("the store is gone");
    const { limiter } = build({ record: () => Promise.reject(failure) });

    await expect(
      limiter.admit({
        clientAddress: "203.0.113.7",
        email: "someone@example.com",
      }),
    ).rejects.toBe(failure);
  });

  it("rejects a store that answers with the wrong number of counts rather than guessing", async () => {
    const { limiter } = build({ record: () => Promise.resolve([1]) });

    await expect(
      limiter.admit({
        clientAddress: "203.0.113.7",
        email: "someone@example.com",
      }),
    ).rejects.toThrow(/count/);
  });

  it("refuses to be built without a secret, which would make every hash guessable", () => {
    expect(() =>
      createClaimRateLimiter({
        store: createInMemoryClaimRateLimitStore(),
        clock: movableClock().clock,
        secret: "",
      }),
    ).toThrow(/secret/);
  });
});
