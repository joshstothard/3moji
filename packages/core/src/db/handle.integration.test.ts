import path from "node:path";

import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool, type PoolClient } from "pg";

import { releasedEmojiSet } from "../emoji/emoji-set";

import { HANDLE_KEY_LENGTH, toHandleKey, type HandleKey } from "./handle-key";

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
const PREFIX = "integration-test-handle";

/**
 * A Handle built from the Emoji Set rather than typed in, so the test travels
 * the same canonicalisation the production write path does — the guard is what
 * is under test as much as the index is.
 */
function handleKeyFromSet(offset: number): HandleKey {
  const emoji = releasedEmojiSet
    .slice(offset, offset + HANDLE_KEY_LENGTH)
    .map((entry) => entry.emoji)
    .join("");
  const key = toHandleKey(emoji);
  if (key === undefined) {
    throw new Error(
      `the released Emoji Set did not yield a canonicalisable Handle at offset ${String(offset)}. Got ${JSON.stringify(emoji)}.`,
    );
  }
  return key;
}

/**
 * A Postgres error code, read without an assertion: `catch` gives `unknown`,
 * and the package's lint rules forbid casting it into shape.
 *
 * `23505` is `unique_violation`. Asserting the *code* rather than "it threw" is
 * what makes this a proof about the index: ADR-0004 decision 7 says the
 * database constraint "is what decides a race between simultaneous claims", and
 * only the code distinguishes that from a connection drop or a typo.
 *
 * **It walks the `cause` chain, and that is not defensive padding.** A raw `pg`
 * client rejects with the driver's own error, which carries `code` directly;
 * `db.execute` rejects with Drizzle's `DrizzleQueryError`, which carries no
 * `code` of its own and keeps the driver error in `cause`. Reading only the top
 * level finds a code on the former and nothing on the latter — which is exactly
 * what CI reported when this suite first ran against a real Postgres.
 */
function postgresErrorCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null) {
    return undefined;
  }
  if ("code" in error && typeof error.code === "string") {
    return error.code;
  }
  return "cause" in error ? postgresErrorCode(error.cause) : undefined;
}

/**
 * The SQLSTATE a write was rejected with, or `"resolved"` if it was not
 * rejected at all.
 *
 * `await expect(promise).rejects.toThrow()` would be satisfied by a connection
 * drop or a typo in the SQL, so every rejection this suite asserts goes through
 * here and names its code.
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
 * These tests **never drop a schema or a table**, for the reason set out in
 * `migrate.integration.test.ts`: it would turn a misaimed `DATABASE_URL` into
 * data loss. They create rows under a known prefix and delete exactly those.
 */
describeWithDatabase("the handle table against a real Postgres", () => {
  let pool: Pool;
  let db: ReturnType<typeof drizzle>;

  const createAccount = async (id: string): Promise<void> => {
    await db.execute(sql`
      INSERT INTO "user" (id, name, email)
      VALUES (${id}, 'Integration Test', ${`${id}@example.com`})
      ON CONFLICT (id) DO NOTHING
    `);
  };

  const countHandles = async (key: string): Promise<string | undefined> => {
    const result = await db.execute<{ count: string }>(
      sql`SELECT count(*) AS count FROM "handle" WHERE key = ${key}`,
    );
    return (result.rows as { count: string }[])[0]?.count;
  };

  /**
   * Run one statement twice **at the same time on two separate connections**,
   * and report how each finished.
   *
   * Both are issued before either is awaited, which is the whole point: two
   * `db.execute` calls on a single Drizzle instance can share a pooled
   * connection and serialise invisibly, and a test that serialises the two
   * inserts proves nothing about a race.
   */
  const raceOnTwoConnections = async (
    statement: string,
    values: readonly [readonly unknown[], readonly unknown[]],
  ): Promise<PromiseSettledResult<unknown>[]> => {
    const clients: PoolClient[] = [];
    try {
      clients.push(await pool.connect(), await pool.connect());
      const [one, two] = clients;
      if (one === undefined || two === undefined) {
        throw new Error("the pool did not hand out two connections");
      }
      return await Promise.allSettled([
        one.query(statement, [...values[0]]),
        two.query(statement, [...values[1]]),
      ]);
    } finally {
      for (const client of clients) {
        client.release();
      }
    }
  };

  /**
   * Delete this suite's own rows and nothing else. Deleting the Accounts takes
   * their Handles with them — which is the cascade the suite asserts, so
   * cleanup and subject agree.
   */
  const removeOwnRows = async (): Promise<void> => {
    await db.execute(sql`DELETE FROM "user" WHERE id LIKE ${`${PREFIX}%`}`);
  };

  beforeAll(async () => {
    pool = new Pool({ connectionString: url });
    db = drizzle(pool);
    // Idempotent, so it does not matter whether another suite migrated first.
    await migrate(db, { migrationsFolder: MIGRATIONS });
    // Before, as well as after: a run killed mid-suite leaves rows behind, and
    // the next run would then see both inserts of the race rejected and fail
    // for a reason that has nothing to do with the code.
    await removeOwnRows();
  });

  afterAll(async () => {
    await removeOwnRows();
    await pool.end();
  });

  it("is created by the migration, and a rerun changes nothing", async () => {
    const exists = async (): Promise<boolean> => {
      const result = await db.execute<{ exists: boolean }>(sql`
        SELECT EXISTS (
          SELECT FROM information_schema.tables
          WHERE table_schema = 'public' AND table_name = 'handle'
        ) AS exists
      `);
      return (result.rows as { exists: boolean }[])[0]?.exists === true;
    };

    expect(await exists()).toBe(true);

    await expect(
      migrate(db, { migrationsFolder: MIGRATIONS }),
    ).resolves.not.toThrow();

    expect(await exists()).toBe(true);
  });

  /**
   * The schema states the collation on the column; this asserts the database
   * actually has it. Without it, the `UNIQUE` guarantee is whatever collation
   * the deployment happened to be created with.
   */
  it("stores the canonical key under the deterministic C collation", async () => {
    const result = await db.execute<{ collation_name: string | null }>(sql`
      SELECT collation_name FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'handle' AND column_name = 'key'
    `);

    expect(
      (result.rows as { collation_name: string | null }[])[0]?.collation_name,
    ).toBe("C");
  });

  /**
   * The acceptance criterion, and the only one that needs real concurrency.
   *
   * **Both INSERTs are in flight at once, on two separate connections.** Two
   * `db.execute` calls on one Drizzle instance can share a pooled connection
   * and serialise invisibly, which would prove nothing, so the clients are
   * checked out by hand and both statements are issued before either is
   * awaited.
   *
   * They run in **autocommit**, and that is deliberate rather than a shortcut.
   * Wrapping each in an explicit `BEGIN` deadlocks the test: the loser's INSERT
   * blocks on the index entry until the winner's *transaction* ends, and the
   * winner cannot commit while the test is awaiting the loser. In autocommit
   * the winner commits the instant its statement returns, the loser unblocks,
   * and Postgres rejects it — the same race, and it terminates.
   *
   * The two rows name **different Accounts**, so a rejection can only have come
   * from the key's index. Were they the same Account, the unique `user_id`
   * could reject the loser and the test would pass while proving nothing about
   * the canonical key.
   */
  it("leaves exactly one row when two Accounts insert the same key at once", async () => {
    const key = handleKeyFromSet(0);
    const first = `${PREFIX}-race-first`;
    const second = `${PREFIX}-race-second`;
    await Promise.all([createAccount(first), createAccount(second)]);

    const insert = `
      INSERT INTO "handle" (key, user_id, held_until)
      VALUES ($1, $2, now() + interval '24 hours')
    `;
    const settled = await raceOnTwoConnections(insert, [
      [key, first],
      [key, second],
    ]);

    const rejections = settled.filter((result) => result.status === "rejected");
    expect(
      settled.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    expect(
      rejections.map((rejection) => postgresErrorCode(rejection.reason)),
    ).toEqual(["23505"]);
    expect(await countHandles(key)).toBe("1");
  });

  it("removes an Account's Handle when the Account is deleted", async () => {
    const key = handleKeyFromSet(HANDLE_KEY_LENGTH);
    const owner = `${PREFIX}-cascade`;
    await createAccount(owner);
    await db.execute(sql`
      INSERT INTO "handle" (key, user_id, held_until)
      VALUES (${key}, ${owner}, now() + interval '24 hours')
    `);
    expect(await countHandles(key)).toBe("1");

    await db.execute(sql`DELETE FROM "user" WHERE id = ${owner}`);

    expect(await countHandles(key)).toBe("0");
  });

  it("refuses a second Handle for the same Account", async () => {
    const owner = `${PREFIX}-one-each`;
    await createAccount(owner);
    const insert = async (key: HandleKey): Promise<void> => {
      await db.execute(sql`
        INSERT INTO "handle" (key, user_id, held_until)
        VALUES (${key}, ${owner}, now() + interval '24 hours')
      `);
    };
    await insert(handleKeyFromSet(HANDLE_KEY_LENGTH * 2));

    // 23505 unique_violation, not merely "it threw": a connection drop would
    // satisfy `rejects.toThrow()` and prove nothing about the constraint.
    await expect(
      rejectionCode(insert(handleKeyFromSet(HANDLE_KEY_LENGTH * 3))),
    ).resolves.toBe("23505");
  });

  /**
   * Decision 7's last layer. The key written here is four code points — what a
   * canonicalisation bug that let a U+FE0F through would produce — and it never
   * passed through `toHandleKey`, which is the point: the database catches it
   * even when the application does not.
   */
  it("refuses a key that is not exactly three code points", async () => {
    const owner = `${PREFIX}-check`;
    await createAccount(owner);
    const fourCodePoints = releasedEmojiSet
      .slice(0, HANDLE_KEY_LENGTH + 1)
      .map((entry) => entry.emoji)
      .join("");

    // 23514 check_violation — the CHECK, specifically, and not the collation
    // or the foreign key tripping for some other reason.
    await expect(
      rejectionCode(
        db.execute(sql`
          INSERT INTO "handle" (key, user_id, held_until)
          VALUES (${fourCodePoints}, ${owner}, now() + interval '24 hours')
        `),
      ),
    ).resolves.toBe("23514");
  });
});
