import path from "node:path";

import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";

import { authSchema } from "../db/schema";
import { curatedEmojiSet } from "../emoji/emoji-name";
import {
  BLOCKED_EMOJI,
  RESERVED_HANDLE_ENTRIES,
  type ReservedHandleList,
} from "../handle/reserved-handles";
import { SEARCH_HANDLE_LIMIT, searchHandles } from "../handle/search-handles";
import {
  createSearchClientRateLimiter,
  searchClientBucket,
} from "../handle/search-rate-limit";

import { createDrizzleClaimRateLimitStore } from "./drizzle-claim-rate-limit-store";
import { createDrizzleHandleSearchIndex } from "./drizzle-handle-search-index";
import { createDrizzleProfileRepository } from "./drizzle-profile-repository";

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

/** Every Account this suite creates starts with this, and only these are deleted. */
const SUITE = `int-search-${String(Date.now())}`;

/** Far in the future and far in the past, so no clock makes a hold ambiguous. */
const FUTURE = new Date("2099-01-01T00:00:00.000Z");
const PAST = new Date("2000-01-01T00:00:00.000Z");

/**
 * Emoji no Reserved rule touches, drawn afresh each run, so this suite's
 * Handles rarely share an emoji with any other suite's rows in a shared
 * database.
 */
function freshEmoji(count: number): readonly string[] {
  const blocked = new Set(BLOCKED_EMOJI.map((entry) => entry.emoji));
  const reserved = new Set(
    RESERVED_HANDLE_ENTRIES.flatMap((entry) => Array.from(entry.key)),
  );
  const pool = curatedEmojiSet
    .map((entry) => entry.emoji)
    .filter((emoji) => !blocked.has(emoji) && !reserved.has(emoji));
  const chosen = new Set<string>();
  while (chosen.size < count) {
    const pick = pool[Math.floor(Math.random() * pool.length)];
    if (pick !== undefined) chosen.add(pick);
  }
  return [...chosen];
}

/**
 * **The header search against a real Postgres**
 * ([ADR-0012](../../../../docs/adr/0012-header-search-lists-claimed-handles-with-display-names-capped-and-rate-limited.md)
 * consequences: "the route must prove its limits").
 *
 * What only a real database can prove: that the containment read finds emoji
 * keys under the `C` collation, that a held Handle — live or expired — and an
 * unclaimed one never come back, that a claimed-then-Reserved Handle is still
 * kept out by the search, that the caps hold over real rows, and that the 61st
 * search in a window is refused by the real counter.
 *
 * These tests never drop anything. They create Accounts under {@link SUITE}
 * and delete exactly those; every Handle and Profile goes with them.
 */
describeWithDatabase("the header search against a real Postgres", () => {
  let pool: Pool;
  let db: ReturnType<typeof drizzle<typeof authSchema>>;

  const [
    MARK = "",
    OTHER = "",
    CAPPED = "",
    ABSENT = "",
    FILL_A = "",
    FILL_B = "",
  ] = freshEmoji(6);

  const keys = {
    claimedNamed: `${MARK}${OTHER}${OTHER}`,
    claimedUnnamed: `${OTHER}${MARK}${OTHER}`,
    held: `${OTHER}${OTHER}${MARK}`,
    expiredHold: `${MARK}${MARK}${OTHER}`,
    reservedLater: `${MARK}${OTHER}${MARK}`,
    unclaimed: `${MARK}${MARK}${MARK}`,
  };

  const RESERVED_LATER: ReservedHandleList = {
    blocked: BLOCKED_EMOJI,
    entries: [
      ...RESERVED_HANDLE_ENTRIES,
      {
        key: keys.reservedLater,
        scope: "platform",
        why: "reserved after it was claimed",
      },
    ],
  };

  const NAME = "Search Integration Owner";

  const seedHandle = async (
    name: string,
    key: string,
    heldUntil: Date,
    claimedAt: Date | null,
  ): Promise<void> => {
    const id = `${SUITE}-${name}`;
    await db.execute(sql`
      INSERT INTO "user" (id, name, email)
      VALUES (${id}, 'Search Integration', ${`${id}@example.com`})
    `);
    await db.execute(sql`
      INSERT INTO handle (key, user_id, held_until, claimed_at)
      VALUES (${key}, ${id}, ${heldUntil}, ${claimedAt})
    `);
  };

  beforeAll(async () => {
    pool = new Pool({ connectionString: url });
    db = drizzle(pool, { schema: authSchema });
    await migrate(db, { migrationsFolder: MIGRATIONS });

    await seedHandle("claimed-named", keys.claimedNamed, PAST, PAST);
    await db.execute(sql`
      INSERT INTO profile (user_id, display_name, updated_at)
      VALUES (${`${SUITE}-claimed-named`}, ${NAME}, ${PAST})
    `);
    await seedHandle("claimed-unnamed", keys.claimedUnnamed, PAST, PAST);
    await seedHandle("held", keys.held, FUTURE, null);
    await seedHandle("expired-hold", keys.expiredHold, PAST, null);
    await seedHandle("reserved-later", keys.reservedLater, PAST, PAST);

    // Never MARK or ABSENT, so the cap's Handles cannot crowd the MARK
    // search's results past five or satisfy an ABSENT group.
    const capped = [FILL_A, FILL_B, CAPPED].flatMap((second) =>
      [FILL_A, FILL_B, CAPPED].map((third) => `${CAPPED}${second}${third}`),
    );
    for (const [at, key] of capped.slice(0, 7).entries()) {
      await seedHandle(`capped-${String(at)}`, key, PAST, PAST);
    }
  });

  afterAll(async () => {
    await db.execute(sql`DELETE FROM "user" WHERE id LIKE ${`${SUITE}%`}`);
    await pool.end();
  });

  describe("the index", () => {
    it("answers claimed Handles holding the emoji, never a live or an expired hold, nor an unclaimed Handle", async () => {
      const found = await createDrizzleHandleSearchIndex(
        db,
      ).claimedKeysContaining([[MARK]], 1000);

      expect(found).toEqual(
        expect.arrayContaining([
          keys.claimedNamed,
          keys.claimedUnnamed,
          keys.reservedLater,
        ]),
      );
      expect(found).not.toContain(keys.held);
      expect(found).not.toContain(keys.expiredHold);
      expect(found).not.toContain(keys.unclaimed);
    });

    it("needs one emoji from every group, and honours its limit", async () => {
      const index = createDrizzleHandleSearchIndex(db);

      expect(
        await index.claimedKeysContaining([[MARK], [ABSENT]], 1000),
      ).not.toEqual(expect.arrayContaining([keys.claimedNamed]));
      expect(
        await index.claimedKeysContaining([[MARK, ABSENT], [OTHER]], 1000),
      ).toEqual(
        expect.arrayContaining([keys.claimedNamed, keys.claimedUnnamed]),
      );
      expect(await index.claimedKeysContaining([[CAPPED]], 3)).toHaveLength(3);
    });

    it("answers exact matches position by position, claimed only", async () => {
      const index = createDrizzleHandleSearchIndex(db);

      expect(
        await index.claimedKeysSaying([[MARK], [OTHER], [OTHER]], 1000),
      ).toEqual([keys.claimedNamed]);

      // MARK MARK OTHER (an expired hold) fits these positions too, and a
      // held Handle is never an answer; OTHER OTHER MARK does not fit.
      const either = await index.claimedKeysSaying(
        [
          [MARK, OTHER],
          [OTHER, MARK],
          [OTHER, ABSENT],
        ],
        1000,
      );
      expect([...either].sort()).toEqual(
        [keys.claimedNamed, keys.claimedUnnamed].sort(),
      );
      expect(
        await index.claimedKeysSaying(
          [[CAPPED], [CAPPED, FILL_A, FILL_B], [CAPPED, FILL_A, FILL_B]],
          2,
        ),
      ).toHaveLength(2);
    });
  });

  describe("searchHandles over the real index and Profiles", () => {
    it("lists claimed Handles with their display names, and never a held, unclaimed or Reserved one", async () => {
      const search = await searchHandles({
        query: MARK,
        index: createDrizzleHandleSearchIndex(db),
        profiles: createDrizzleProfileRepository(db),
        list: RESERVED_LATER,
      });

      const shown = search.handles.map((found) => found.key);
      expect(shown).toEqual(
        expect.arrayContaining([keys.claimedNamed, keys.claimedUnnamed]),
      );
      for (const hidden of [
        keys.held,
        keys.expiredHold,
        keys.reservedLater,
        keys.unclaimed,
      ]) {
        expect(shown).not.toContain(hidden);
      }
      expect(
        search.handles.find((found) => found.key === keys.claimedNamed)
          ?.displayName,
      ).toBe(NAME);
      expect(
        search.handles.find((found) => found.key === keys.claimedUnnamed)
          ?.displayName,
      ).toBeNull();
    });

    it("holds the Handle cap over real rows", async () => {
      const search = await searchHandles({
        query: CAPPED,
        index: createDrizzleHandleSearchIndex(db),
        profiles: createDrizzleProfileRepository(db),
      });

      expect(search.handles).toHaveLength(SEARCH_HANDLE_LIMIT);
    });
  });

  describe("the rate limit over the real counter", () => {
    it("admits sixty searches from one client address in a window and refuses the sixty-first", async () => {
      // A secret no other run shares, so counts never carry between runs.
      const secret = `${SUITE}-secret-that-is-long-enough`;
      const clientAddress = "198.51.100.254";
      const limiter = createSearchClientRateLimiter({
        store: createDrizzleClaimRateLimitStore({ db }),
        clock: { now: () => new Date("2099-01-01T10:03:00.000Z") },
        secret,
      });

      const states: string[] = [];
      for (let request = 0; request < 61; request += 1) {
        states.push((await limiter.admit(clientAddress)).state);
      }

      expect(states.slice(0, 60)).toEqual(Array(60).fill("admitted"));
      expect(states[60]).toBe("rate-limited");

      await db.execute(
        sql`DELETE FROM claim_rate_limit WHERE bucket = ${searchClientBucket(secret, clientAddress)}`,
      );
    });
  });
});
