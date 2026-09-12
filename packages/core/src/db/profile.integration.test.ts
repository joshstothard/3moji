import path from "node:path";

import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";

import { createDrizzleProfileRepository } from "../adapters/drizzle-profile-repository";
import { releasedEmojiSet } from "../emoji/emoji-set";

import { HANDLE_KEY_LENGTH, toHandleKey, type HandleKey } from "./handle-key";
import { LINK_LIMIT } from "./link";
import { authSchema } from "./schema";

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

/** Every row this suite creates carries this prefix, and only these are deleted. */
const PREFIX = "integration-test-profile";

const NOW = new Date("2026-09-12T12:00:00.000Z");
const HELD_UNTIL = new Date("2026-09-13T12:00:00.000Z");

/** `23505` unique_violation, `23503` foreign_key_violation, `23514` check_violation. */
const UNIQUE_VIOLATION = "23505";
const FOREIGN_KEY_VIOLATION = "23503";
const CHECK_VIOLATION = "23514";

/**
 * A Handle from the Emoji Set, canonicalised the way the write path does.
 *
 * The offsets below start above every other suite's window — `handle.integration`
 * 0-15, `drizzle-handle-repository` 0-18, `verification.integration` 0-30,
 * `claim.integration` up to 45, `release.integration` up to
 * `HANDLE_KEY_LENGTH * 21` — because `maxWorkers: 1` means all of them share
 * one database.
 */
function handleKeyFromSet(offset: number): HandleKey {
  const emoji = releasedEmojiSet
    .slice(offset, offset + HANDLE_KEY_LENGTH)
    .map((entry) => entry.emoji)
    .join("");
  const key = toHandleKey(emoji);
  if (key === undefined) {
    throw new Error(
      `the released Emoji Set did not yield a canonicalisable Handle at offset ${String(offset)}.`,
    );
  }
  return key;
}

const KEYS = {
  ordered: handleKeyFromSet(HANDLE_KEY_LENGTH * 22),
  cascaded: handleKeyFromSet(HANDLE_KEY_LENGTH * 23),
  unedited: handleKeyFromSet(HANDLE_KEY_LENGTH * 24),
  bare: handleKeyFromSet(HANDLE_KEY_LENGTH * 25),
  limited: handleKeyFromSet(HANDLE_KEY_LENGTH * 26),
} as const;

/**
 * A Postgres error code, read without an assertion: `catch` gives `unknown`,
 * and the package's lint rules forbid casting it into shape. It walks the
 * `cause` chain because `db.execute` rejects with Drizzle's own error, which
 * keeps the driver's — the one carrying the SQLSTATE — in `cause`.
 */
function postgresErrorCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  if ("code" in error && typeof error.code === "string") return error.code;
  return "cause" in error ? postgresErrorCode(error.cause) : undefined;
}

/**
 * The SQLSTATE a write was rejected with, or `"resolved"` if it was not
 * rejected at all. `rejects.toThrow()` would be satisfied by a connection drop
 * or a typo in the SQL, so every rejection here names its code.
 */
async function rejectionCode(write: Promise<unknown>): Promise<string> {
  try {
    await write;
    return "resolved";
  } catch (error) {
    return postgresErrorCode(error) ?? "no postgres error code";
  }
}

/**
 * The `profile` and `link` tables against a real Postgres.
 *
 * These tests **never drop a schema or a table**, for the reason set out in
 * `migrate.integration.test.ts`: it would turn a misaimed `DATABASE_URL` into
 * data loss. They create rows under a known prefix and delete exactly those —
 * and since both tables cascade from `user`, deleting the Accounts is the whole
 * cleanup.
 *
 * What only a real database can prove here:
 *
 * - **The two-hop cascade.** `user → profile → link`. No fake store can fail to
 *   cascade, and a one-hop cascade that stops at `profile` would leave orphaned
 *   Links that no code path can ever reach or delete.
 * - **That the read orders by `position`.** A dropped `ORDER BY` passes every
 *   in-memory test, because an array built by hand is already in order.
 * - **That "at most ten Links" is structural**, not a count the write path has
 *   to remember to take.
 */
describeWithDatabase(
  "the profile and link tables against a real Postgres",
  () => {
    let pool: Pool;
    // Typed with the auth schema, because `Database` is — a bare `drizzle(pool)`
    // infers `Record<string, unknown>` and will not satisfy the port's adapter.
    let db: ReturnType<typeof drizzle<typeof authSchema>>;

    const accountFor = (name: string): string => `${PREFIX}-${name}`;

    const createClaimedHandle = async (
      name: string,
      key: HandleKey,
    ): Promise<string> => {
      const userId = accountFor(name);
      await db.execute(sql`
      INSERT INTO "user" (id, name, email)
      VALUES (${userId}, 'Integration Test', ${`${userId}@example.com`})
      ON CONFLICT (id) DO NOTHING
    `);
      await db.execute(sql`
      INSERT INTO "handle" (key, user_id, held_until, claimed_at)
      VALUES (${key}, ${userId}, ${HELD_UNTIL.toISOString()}, ${NOW.toISOString()})
    `);
      return userId;
    };

    const createProfile = async (userId: string): Promise<void> => {
      await db.execute(sql`
      INSERT INTO "profile" (user_id, display_name, bio, updated_at)
      VALUES (${userId}, 'A Name', 'A bio', ${NOW.toISOString()})
    `);
    };

    const insertLink = async (input: {
      id: string;
      userId: string;
      title: string;
      position: number;
    }): Promise<void> => {
      await db.execute(sql`
      INSERT INTO "link" (id, user_id, title, url, position)
      VALUES (${input.id}, ${input.userId}, ${input.title}, ${`https://example.com/${input.title}`}, ${input.position})
    `);
    };

    const countWhere = async (
      table: "profile" | "link",
      userId: string,
    ): Promise<string | undefined> => {
      const statement =
        table === "profile"
          ? sql`SELECT count(*) AS count FROM "profile" WHERE user_id = ${userId}`
          : sql`SELECT count(*) AS count FROM "link" WHERE user_id = ${userId}`;
      const result = await db.execute<{ count: string }>(statement);
      return (result.rows as { count: string }[])[0]?.count;
    };

    const removeOwnRows = async (): Promise<void> => {
      await db.execute(sql`DELETE FROM "user" WHERE id LIKE ${`${PREFIX}%`}`);
    };

    beforeAll(async () => {
      pool = new Pool({ connectionString: url });
      db = drizzle(pool, { schema: authSchema });
      // Idempotent, so it does not matter whether another suite migrated first.
      await migrate(db, { migrationsFolder: MIGRATIONS });
      // Before as well as after: a run killed mid-suite leaves rows behind.
      await removeOwnRows();
    });

    afterAll(async () => {
      await removeOwnRows();
      await pool.end();
    });

    it("creates both tables, and a rerun changes nothing", async () => {
      await migrate(db, { migrationsFolder: MIGRATIONS });

      const result = await db.execute<{ table_name: string }>(sql`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name IN ('profile', 'link')
      ORDER BY table_name
    `);

      expect(
        (result.rows as { table_name: string }[]).map((row) => row.table_name),
      ).toEqual(["link", "profile"]);
    });

    /**
     * ADR-0004 decision 5: "Releasing takes the Profile and its Links with it."
     * Release *is* account deletion, so the only thing that has to be true is
     * that deleting the `user` row takes both tables with it — in one hop for
     * `profile`, and in two for `link`, which is the half that is easy to believe
     * in and easy to get wrong.
     */
    it("removes the Profile and its Links when the Account is deleted", async () => {
      const userId = await createClaimedHandle("cascade", KEYS.cascaded);
      await createProfile(userId);
      await insertLink({ id: `${userId}-a`, userId, title: "a", position: 0 });
      await insertLink({ id: `${userId}-b`, userId, title: "b", position: 1 });

      expect(await countWhere("profile", userId)).toBe("1");
      expect(await countWhere("link", userId)).toBe("2");

      await db.execute(sql`DELETE FROM "user" WHERE id = ${userId}`);

      expect(await countWhere("profile", userId)).toBe("0");
      expect(await countWhere("link", userId)).toBe("0");
    });

    /**
     * The ordering proof, and the reason its fixture looks perverse.
     *
     * The three orders that could be mistaken for each other are deliberately
     * made to **disagree with each other**: insertion order is c, a, b; `id` sort
     * order is a, b, c; and the owner's order is b, c, a. Any two of them
     * coinciding would let a read that dropped the `ORDER BY` pass by accident,
     * which is exactly the bug the criterion is about.
     */
    it("returns Links in the owner's order, not insertion order and not by id", async () => {
      const userId = await createClaimedHandle("ordered", KEYS.ordered);
      await createProfile(userId);
      await insertLink({ id: `${userId}-c`, userId, title: "c", position: 1 });
      await insertLink({ id: `${userId}-a`, userId, title: "a", position: 2 });
      await insertLink({ id: `${userId}-b`, userId, title: "b", position: 0 });

      const found = await createDrizzleProfileRepository(db).profileOf(
        KEYS.ordered,
      );

      expect(found?.links.map((one) => one.title)).toEqual(["b", "c", "a"]);
      expect(found?.links.map((one) => one.position)).toEqual([0, 1, 2]);
      expect(found?.displayName).toBe("A Name");
      expect(found?.bio).toBe("A bio");
    });

    /**
     * The "claimed but unedited" signal, at the level that produces it: a claimed
     * Handle with no `profile` row reads as `undefined` rather than as a Profile
     * whose fields all happen to be null. `profileStateOf` turns that into a
     * named state; this asserts the half the database owns.
     */
    it("answers undefined for a claimed Handle whose owner has never edited anything", async () => {
      await createClaimedHandle("unedited", KEYS.unedited);

      const found = await createDrizzleProfileRepository(db).profileOf(
        KEYS.unedited,
      );

      expect(found).toBeUndefined();
    });

    it("answers a Profile with no Links as an empty list, not as undefined", async () => {
      const userId = await createClaimedHandle("bare", KEYS.bare);
      await createProfile(userId);

      const found = await createDrizzleProfileRepository(db).profileOf(
        KEYS.bare,
      );

      expect(found?.links).toEqual([]);
      expect(found?.displayName).toBe("A Name");
    });

    /**
     * "At most ten Links" without a trigger and without a `COUNT(*)` in a
     * transaction: ten positions in `0…9`, no two Links sharing one, and nowhere
     * for an eleventh to go. Both halves are asserted, because either alone
     * leaves a hole — the range without the uniqueness would allow ten Links all
     * at position 0, and the uniqueness without the range would allow an
     * unbounded list.
     */
    it("refuses an eleventh Link, and two Links at the same position", async () => {
      const userId = await createClaimedHandle("limited", KEYS.limited);
      await createProfile(userId);
      await insertLink({ id: `${userId}-0`, userId, title: "0", position: 0 });

      const beyondLimit = await rejectionCode(
        insertLink({
          id: `${userId}-over`,
          userId,
          title: "over",
          position: LINK_LIMIT,
        }),
      );
      const duplicatePosition = await rejectionCode(
        insertLink({ id: `${userId}-dup`, userId, title: "dup", position: 0 }),
      );

      expect(beyondLimit).toBe(CHECK_VIOLATION);
      expect(duplicatePosition).toBe(UNIQUE_VIOLATION);
    });

    /**
     * A Link without a Profile is not a state the product has, and the foreign
     * key is what makes it unrepresentable rather than merely unwritten. The
     * Account here is real and its Handle is claimed — only the `profile` row is
     * missing — so this fails for the reason it claims to.
     */
    it("refuses a Link whose Account has no Profile", async () => {
      const userId = await createClaimedHandle(
        "orphan",
        handleKeyFromSet(HANDLE_KEY_LENGTH * 27),
      );

      const code = await rejectionCode(
        insertLink({ id: `${userId}-x`, userId, title: "x", position: 0 }),
      );

      expect(code).toBe(FOREIGN_KEY_VIOLATION);
    });
  },
);
