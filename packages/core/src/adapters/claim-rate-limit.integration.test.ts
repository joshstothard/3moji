import path from "node:path";

import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";

import { postgresErrorCode } from "../db/postgres-error";
import { authSchema } from "../db/schema";
import {
  claimRateLimitBuckets,
  createClaimRateLimiter,
} from "../handle/claim-rate-limit";
import type { Clock } from "../ports/clock";

import { createDrizzleClaimRateLimitStore } from "./drizzle-claim-rate-limit-store";

const url = process.env.DATABASE_URL;

// Fail loudly rather than skipping silently in CI: a green run that tested
// nothing is worse than a red one.
if (url === undefined && process.env.CI !== undefined) {
  throw new Error(
    "DATABASE_URL is not set. CI's integration-tests job must provide a Postgres service.",
  );
}

const describeWithDatabase = url === undefined ? describe.skip : describe;

const MIGRATIONS = path.join(__dirname, "..", "..", "migrations");

/** Every bucket this suite writes starts with this, and only these are deleted. */
const SUITE = `int-claim-rate-limit-${String(Date.now())}`;

/** Far enough in the future that no other run's pruning reaches these rows. */
const WINDOW = new Date("2099-01-01T10:00:00.000Z");
const NEXT_WINDOW = new Date("2099-01-01T11:00:00.000Z");
const HOUR = 60 * 60 * 1000;

/** How many submissions race each other. Each gets its own connection. */
const RACERS = 24;

/** Every rendering an error tracker could capture, down the `cause` chain. */
function everythingSaidBy(error: unknown): string {
  const said: string[] = [];
  let current: unknown = error;
  for (let depth = 0; depth < 8 && current !== undefined; depth += 1) {
    if (typeof current !== "object" || current === null) {
      said.push(JSON.stringify(current));
      break;
    }
    said.push(Error.prototype.toString.call(current));
    said.push(JSON.stringify(current));
    if ("message" in current) said.push(String(current.message));
    if ("stack" in current) said.push(String(current.stack));
    current = "cause" in current ? current.cause : undefined;
  }
  return said.join("\n");
}

async function rejectionOf(work: Promise<unknown>): Promise<unknown> {
  try {
    await work;
  } catch (error) {
    return error;
  }
  throw new Error("expected the store to reject, and it resolved.");
}

/**
 * **The Claim's rate limit against a real Postgres**
 * ([#157](https://github.com/joshstothard/3moji/issues/157)).
 *
 * What only a real database can prove: that the `ON CONFLICT … DO UPDATE`
 * increment really is atomic when submissions race on separate connections,
 * that the counts the limiter decides on are the ones stored, and that a
 * statement Postgres rejects leaves the adapter without its bound bucket hash.
 *
 * These tests never drop anything. They write buckets under {@link SUITE} and
 * delete exactly those.
 */
describeWithDatabase("the Claim's rate limit against a real Postgres", () => {
  let pool: Pool;
  let db: ReturnType<typeof drizzle<typeof authSchema>>;

  const bucket = (name: string): string => `${SUITE}-${name}`;

  const storedCount = async (
    name: string,
    windowStart: Date,
  ): Promise<number | undefined> => {
    const result = await db.execute<{ count: number }>(sql`
      SELECT count FROM claim_rate_limit
      WHERE bucket = ${bucket(name)} AND window_start = ${windowStart}
    `);
    return (result.rows as { count: number }[])[0]?.count;
  };

  beforeAll(async () => {
    // Enough connections that every racer holds its own at once.
    pool = new Pool({ connectionString: url, max: RACERS + 2 });
    db = drizzle(pool, { schema: authSchema });
    await migrate(db, { migrationsFolder: MIGRATIONS });
  });

  afterAll(async () => {
    await db.execute(
      sql`DELETE FROM claim_rate_limit WHERE bucket LIKE ${`${SUITE}%`}`,
    );
    await pool.end();
  });

  describe("the store", () => {
    it("counts each submission in place and answers every bucket's new count, in order", async () => {
      const store = createDrizzleClaimRateLimitStore({ db });
      const hits = [
        { bucket: bucket("order-client"), windowStart: WINDOW },
        { bucket: bucket("order-email"), windowStart: WINDOW },
      ];

      expect(await store.record(hits, WINDOW)).toEqual([1, 1]);
      expect(await store.record(hits, WINDOW)).toEqual([2, 2]);
      expect(
        await store.record(
          [
            { bucket: bucket("order-other"), windowStart: WINDOW },
            { bucket: bucket("order-email"), windowStart: WINDOW },
          ],
          WINDOW,
        ),
      ).toEqual([1, 3]);
      expect(await storedCount("order-email", WINDOW)).toBe(3);
    });

    it("counts a new window from one", async () => {
      const store = createDrizzleClaimRateLimitStore({ db });
      const at = (windowStart: Date) => [
        { bucket: bucket("windows"), windowStart },
      ];

      await store.record(at(WINDOW), WINDOW);
      await store.record(at(WINDOW), WINDOW);

      expect(await store.record(at(NEXT_WINDOW), WINDOW)).toEqual([1]);
    });

    it("forgets windows that ended, so the table keeps no more history than the limit reads", async () => {
      const store = createDrizzleClaimRateLimitStore({ db });
      await store.record(
        [{ bucket: bucket("forget"), windowStart: WINDOW }],
        WINDOW,
      );

      await store.record(
        [{ bucket: bucket("forget"), windowStart: NEXT_WINDOW }],
        NEXT_WINDOW,
      );

      expect(await storedCount("forget", WINDOW)).toBeUndefined();
      expect(await storedCount("forget", NEXT_WINDOW)).toBe(1);
    });

    it("counts every one of many simultaneous submissions exactly once", async () => {
      // Each racer gets its own store call issued before any is awaited, and
      // the pool holds a connection for each, so the increments genuinely
      // overlap in Postgres. A read-then-write increment loses updates here:
      // several racers read the same count and write the same next value, so
      // the answers repeat and the stored total falls short.
      const store = createDrizzleClaimRateLimitStore({ db });

      const answers = await Promise.all(
        Array.from({ length: RACERS }, (_unused, racer) =>
          store.record(
            [
              {
                bucket: bucket(`race-client-${String(racer)}`),
                windowStart: WINDOW,
              },
              { bucket: bucket("race-email"), windowStart: WINDOW },
            ],
            WINDOW,
          ),
        ),
      );

      const emailCounts = answers
        .map((counts) => counts[1])
        .sort((one, two) => (one ?? 0) - (two ?? 0));
      expect(emailCounts).toEqual(
        Array.from({ length: RACERS }, (_unused, index) => index + 1),
      );
      expect(await storedCount("race-email", WINDOW)).toBe(RACERS);
    });

    it("rejects a statement Postgres refuses as DatabaseQueryFailed, carrying no bucket hash", async () => {
      // One bucket twice in one upsert is refused by Postgres itself
      // (`21000`, "ON CONFLICT DO UPDATE command cannot affect row a second
      // time") — a real server-side rejection of a statement that binds bucket
      // values, which is what must not leave the adapter with them.
      const store = createDrizzleClaimRateLimitStore({ db });
      const secretish = bucket("must-not-leak");

      const error = await rejectionOf(
        store.record(
          [
            { bucket: secretish, windowStart: WINDOW },
            { bucket: secretish, windowStart: WINDOW },
          ],
          WINDOW,
        ),
      );

      expect(postgresErrorCode(error)).toBe("21000");
      expect(
        typeof error === "object" && error !== null && "name" in error
          ? error.name
          : undefined,
      ).toBe("DatabaseQueryFailed");
      expect(everythingSaidBy(error)).not.toContain(SUITE);
      expect(await storedCount("must-not-leak", WINDOW)).toBeUndefined();
    });
  });

  describe("the limiter over the real store", () => {
    const movableClock = (): {
      clock: Clock;
      advance: (ms: number) => void;
    } => {
      let now = WINDOW.getTime() + 5 * 60 * 1000;
      return {
        clock: { now: () => new Date(now) },
        advance: (ms) => {
          now += ms;
        },
      };
    };

    /** A secret no other run shares, so counts never carry between runs. */
    const secret = `${SUITE}-secret-that-is-long-enough`;

    const cleanUpEmailBuckets = async (emails: readonly string[]) => {
      // The limiter's buckets are hashes, not `SUITE`-prefixed, so they are
      // found through the same function that wrote them.

      for (const email of emails) {
        const buckets = claimRateLimitBuckets({
          secret,
          clientAddress: undefined,
          email,
        });
        await db.execute(
          sql`DELETE FROM claim_rate_limit WHERE bucket = ${buckets.email}`,
        );
      }
    };

    it("admits three submissions naming one address in an hour, refuses the rest, and starts again next hour", async () => {
      const { clock, advance } = movableClock();
      const limiter = createClaimRateLimiter({
        store: createDrizzleClaimRateLimitStore({ db }),
        clock,
        secret,
      });
      const email = `${SUITE}-limited@example.com`;

      const answers: string[] = [];
      for (let submission = 0; submission < 5; submission += 1) {
        answers.push(
          await limiter.admit({
            clientAddress: `198.51.100.${String(submission + 1)}`,
            // The case varies and the counter does not care (#163).
            email: submission % 2 === 0 ? email : email.toUpperCase(),
          }),
        );
      }
      advance(HOUR);
      answers.push(
        await limiter.admit({ clientAddress: "198.51.100.99", email }),
      );

      expect(answers).toEqual([
        "admitted",
        "admitted",
        "admitted",
        "rate-limited",
        "rate-limited",
        "admitted",
      ]);

      await cleanUpEmailBuckets([email]);
    });

    it("admits ten submissions from one client address in an hour, then refuses", async () => {
      const { clock } = movableClock();
      const limiter = createClaimRateLimiter({
        store: createDrizzleClaimRateLimitStore({ db }),
        clock,
        secret,
      });
      const emails = Array.from(
        { length: 11 },
        (_unused, index) => `${SUITE}-client-${String(index)}@example.com`,
      );

      const answers: string[] = [];
      for (const email of emails) {
        answers.push(
          await limiter.admit({ clientAddress: "2001:db8:157::1", email }),
        );
      }

      expect(answers.slice(0, 10)).toEqual(Array(10).fill("admitted"));
      expect(answers[10]).toBe("rate-limited");

      await cleanUpEmailBuckets(emails);
    });

    it("stores no email address and no client address, only their keyed hashes", async () => {
      const { clock } = movableClock();
      const limiter = createClaimRateLimiter({
        store: createDrizzleClaimRateLimitStore({ db }),
        clock,
        secret,
      });
      const email = `${SUITE}-private@example.com`;

      await limiter.admit({ clientAddress: "192.0.2.157", email });

      const leaked = await db.execute<{ bucket: string }>(sql`
        SELECT bucket FROM claim_rate_limit
        WHERE bucket LIKE ${`%${SUITE}-private%`} OR bucket LIKE '%192.0.2.157%'
      `);
      expect(leaked.rows).toEqual([]);

      await cleanUpEmailBuckets([email]);
    });
  });
});
