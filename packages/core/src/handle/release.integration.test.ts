import path from "node:path";

import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";

import { createDrizzleClaimStore } from "../adapters/drizzle-claim-store";
import {
  createDrizzleReleaseStore,
  releaseTransactionOn,
} from "../adapters/drizzle-release-store";
import { createRecordingEmailSender } from "../auth/adapters/recording-email-sender";
import type { AuthFactory } from "../auth/auth-factory";
import { createAuth } from "../auth/create-auth";
import {
  HANDLE_KEY_LENGTH,
  toHandleKey,
  type HandleKey,
} from "../db/handle-key";
import { postgresErrorCode } from "../db/postgres-error";
import { authSchema } from "../db/schema";
import { releasedEmojiSet } from "../emoji/emoji-set";
import type { Clock } from "../ports/clock";
import type { ClaimStore } from "../ports/claim-store";
import type { ReleaseStore } from "../ports/release-store";
import { claimHandle, type ClaimResult } from "./claim-handle";
import { releaseHandle, type ReleaseResult } from "./release-handle";

const url = process.env.DATABASE_URL;

// Fail loudly rather than skipping silently in CI: a green run that tested
// nothing is worse than a red one.
if (url === undefined && process.env.CI !== undefined) {
  throw new Error(
    "DATABASE_URL is not set. CI's integration-tests job must provide a Postgres service.",
  );
}

/** `not_null_violation`: the column the row cannot do without was omitted. */
const NOT_NULL_VIOLATION = "23502";

const describeWithDatabase = url === undefined ? describe.skip : describe;

const MIGRATIONS = path.join(__dirname, "..", "..", "migrations");
const PASSWORD = "correct horse battery staple";
const NOW = new Date("2026-09-12T12:00:00.000Z");
const fixedClock: Clock = { now: () => NOW };
/** The instant the Release happens. Nothing sleeps; time is injected. */
const RELEASED_AT = new Date("2026-09-12T12:05:00.000Z");
const releaseClock: Clock = { now: () => RELEASED_AT };
/**
 * The instant the released Handle is claimed again — **the same instant it was
 * released**. A cooldown of any length at all would refuse this.
 */
const reclaimClock: Clock = { now: () => RELEASED_AT };

/** Every Account this suite creates carries this tag, and only these are deleted. */
const SUITE_TAG = `release-int-${String(Date.now())}`;
const addressFor = (name: string): string => `${SUITE_TAG}-${name}@example.com`;

/**
 * The Handles this suite uses, so its tombstones can be deleted **exactly**.
 *
 * `released_handle` has no foreign key to `user` (ADR-0009 decision 3), which
 * means the `DELETE FROM "user"` that cleans up every other table does not
 * touch it. Offsets start above `claim.integration.test.ts`'s highest, because
 * both suites share one database.
 */
const usedKeys = new Set<string>();

/** A Handle from the Emoji Set, canonicalised the way the write path does. */
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
  usedKeys.add(key);
  return key;
}

/**
 * Release against a real Postgres.
 *
 * **These tests never drop a schema or a table.** Every Account they create
 * carries `SUITE_TAG` in its email, and every tombstone they leave is deleted
 * by its own key.
 *
 * What only a real database can prove here:
 *
 * - **The cascade is what makes Release account deletion.** Deleting the `user`
 *   row is what takes the Handle, the sessions, the credential rows and the
 *   dispatch history with it. No fake store can fail to cascade.
 * - **A just-released Handle is claimable immediately** (ADR-0009 decision 1).
 *   This is [#63](https://github.com/joshstothard/3moji/issues/63)'s
 *   outstanding acceptance criterion, and it is satisfied by accident unless a
 *   test makes it deliberate — see the stale-tombstone case below, which is the
 *   one that fails the day somebody adds a read to the claim gate.
 * - **The tombstone's shape.** The column set is read back from
 *   `information_schema`, so the row cannot quietly grow a `user_id`.
 */
describeWithDatabase("Release against a real Postgres", () => {
  let pool: Pool;
  let db: ReturnType<typeof drizzle<typeof authSchema>>;
  let emailSender: ReturnType<typeof createRecordingEmailSender>;
  let claims: ClaimStore;
  let releases: ReleaseStore;

  const claim = (input: {
    segment: string;
    email: string;
    clock?: Clock;
  }): Promise<ClaimResult> =>
    claimHandle({
      segment: input.segment,
      email: input.email,
      password: PASSWORD,
      store: claims,
      clock: input.clock ?? fixedClock,
    });

  const release = (
    userId: string,
    clock: Clock = releaseClock,
  ): Promise<ReleaseResult> =>
    releaseHandle({ userId, store: releases, clock });

  const userIdOf = async (email: string): Promise<string> => {
    const result = await db.execute<{ id: string }>(
      sql`SELECT id FROM "user" WHERE email = ${email}`,
    );
    const id = (result.rows as { id: string }[])[0]?.id;
    if (id === undefined) {
      throw new Error(`no Account exists for ${email}.`);
    }
    return id;
  };

  const countUsers = async (email: string): Promise<string | undefined> => {
    const result = await db.execute<{ count: string }>(
      sql`SELECT count(*) AS count FROM "user" WHERE email = ${email}`,
    );
    return (result.rows as { count: string }[])[0]?.count;
  };

  const countHandles = async (key: string): Promise<string | undefined> => {
    const result = await db.execute<{ count: string }>(
      sql`SELECT count(*) AS count FROM "handle" WHERE key = ${key}`,
    );
    return (result.rows as { count: string }[])[0]?.count;
  };

  /** Every tombstone for a key, oldest first. `SELECT *` on purpose: the test
   * below asserts what the row holds, so it must see every column there is. */
  const tombstonesFor = async (
    key: string,
  ): Promise<Record<string, unknown>[]> => {
    const result = await db.execute(
      sql`SELECT * FROM "released_handle" WHERE key = ${key} ORDER BY released_at`,
    );
    return result.rows;
  };

  const removeOwnRows = async (): Promise<void> => {
    await db.execute(
      sql`DELETE FROM "user" WHERE email LIKE ${`${SUITE_TAG}%`}`,
    );
    for (const key of usedKeys) {
      await db.execute(sql`DELETE FROM "released_handle" WHERE key = ${key}`);
    }
  };

  beforeAll(async () => {
    pool = new Pool({
      connectionString: url,
      options: "-c statement_timeout=10000",
    });
    db = drizzle(pool, { schema: authSchema });
    // Idempotent, so it does not matter whether another suite migrated first.
    await migrate(db, { migrationsFolder: MIGRATIONS });

    emailSender = createRecordingEmailSender();
    const auth: AuthFactory = ({
      db: client,
      emailSender: sender,
      dispatches,
    }) =>
      createAuth({
        db: client,
        emailSender: sender,
        dispatches,
        clock: { now: () => new Date() },
        baseUrl: "http://localhost:3000",
        secret: "integration-test-secret-of-sufficient-length",
        from: "3moji <no-reply@mail.3moji.me>",
      });
    claims = createDrizzleClaimStore({ db, auth, emailSender });
    releases = createDrizzleReleaseStore({ db });
    await removeOwnRows();
  });

  afterAll(async () => {
    await removeOwnRows();
    await pool.end();
  });

  beforeEach(() => {
    emailSender.clear();
  });

  /**
   * **Release is account deletion** (ADR-0004 decision 5), and the cascade is
   * what makes that true: the `user` row is what gets deleted, and the Handle,
   * the sessions, the credential rows and the verification dispatches go with
   * it. Phase 4's Profile and Links will hang off the same row.
   */
  it("deletes the Account and the Handle with it, and writes one tombstone", async () => {
    const key = handleKeyFromSet(HANDLE_KEY_LENGTH * 16);
    const email = addressFor("deletes");
    await claim({ segment: key, email });
    const userId = await userIdOf(email);

    const result = await release(userId);

    expect(result).toEqual({
      state: "released",
      key,
      releasedAt: RELEASED_AT,
    });
    expect(await countUsers(email)).toBe("0");
    expect(await countHandles(key)).toBe("0");
    // Everything that references `user.id` went with it.
    const sessions = await db.execute<{ count: string }>(
      sql`SELECT count(*) AS count FROM "session" WHERE user_id = ${userId}`,
    );
    expect((sessions.rows as { count: string }[])[0]?.count).toBe("0");
    const credentials = await db.execute<{ count: string }>(
      sql`SELECT count(*) AS count FROM "account" WHERE user_id = ${userId}`,
    );
    expect((credentials.rows as { count: string }[])[0]?.count).toBe("0");
    const dispatches = await db.execute<{ count: string }>(
      sql`SELECT count(*) AS count FROM "verification_dispatch" WHERE user_id = ${userId}`,
    );
    expect((dispatches.rows as { count: string }[])[0]?.count).toBe("0");

    const tombstones = await tombstonesFor(key);
    expect(tombstones).toHaveLength(1);
    // From the injected Clock, not from a SQL default.
    expect(new Date(String(tombstones[0]?.released_at)).toISOString()).toBe(
      RELEASED_AT.toISOString(),
    );
  });

  /**
   * **ADR-0009 decision 3, read back from the database rather than from the
   * Drizzle model.** The column set is the assertion, not the values: the
   * realistic failure this table has is a `user_id` added later for
   * convenience, and only an exhaustive check goes red for it.
   *
   * The row's own contents are checked too — nothing in it is the released
   * Account's id or address, so a tombstone alone identifies nobody.
   */
  it("leaves a tombstone that names no Account", async () => {
    const key = handleKeyFromSet(HANDLE_KEY_LENGTH * 17);
    const email = addressFor("anonymous");
    await claim({ segment: key, email });
    const userId = await userIdOf(email);

    await release(userId);

    const columns = await db.execute<{ column_name: string }>(sql`
      SELECT column_name FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'released_handle'
      ORDER BY column_name
    `);
    expect(
      (columns.rows as { column_name: string }[]).map(
        (column) => column.column_name,
      ),
    ).toEqual(["id", "key", "released_at"]);

    const tombstones = await tombstonesFor(key);
    expect(tombstones).toHaveLength(1);
    const serialised = JSON.stringify(tombstones[0]);
    expect(serialised).not.toContain(userId);
    expect(serialised).not.toContain(email);
    expect(serialised).not.toContain(SUITE_TAG);
  });

  /**
   * **#63's outstanding acceptance criterion: a just-released Handle can be
   * claimed immediately.**
   *
   * The reclaim happens at the very instant of the release — the clock does not
   * move — so a cooldown of any length would refuse it. The tombstone is
   * asserted to be **there first**, so the Claim is proved to succeed in its
   * presence rather than in its absence.
   */
  it("lets somebody else claim the Handle the instant it is released", async () => {
    const key = handleKeyFromSet(HANDLE_KEY_LENGTH * 18);
    const owner = addressFor("immediate-owner");
    const newcomer = addressFor("immediate-newcomer");
    await claim({ segment: key, email: owner });
    await release(await userIdOf(owner));
    expect(await tombstonesFor(key)).toHaveLength(1);

    const result = await claim({
      segment: key,
      email: newcomer,
      clock: reclaimClock,
    });

    expect(result.state).toBe("held");
    expect(await countHandles(key)).toBe("1");
    expect(await countUsers(newcomer)).toBe("1");
  });

  /**
   * Decision 1 says "by anyone, **including its previous owner**", and the same
   * address is the case a cooldown would have been aimed at. It is also the
   * case that proves the deletion was real: the reclaim creates a *new*
   * Account, because the old one no longer exists to collide with.
   */
  it("lets the previous owner reclaim their own Handle immediately", async () => {
    const key = handleKeyFromSet(HANDLE_KEY_LENGTH * 19);
    const email = addressFor("previous-owner");
    await claim({ segment: key, email });
    const before = await userIdOf(email);
    await release(before);

    const result = await claim({ segment: key, email, clock: reclaimClock });

    expect(result.state).toBe("held");
    const after = await userIdOf(email);
    expect(after).not.toBe(before);
    expect(await countUsers(email)).toBe("1");
  });

  /**
   * **The claim path does not read the tombstone** (ADR-0009 decision 5), and
   * this is the test that says so rather than assuming it.
   *
   * The two tests above pass even if the tombstone were never written *and*
   * even if the claim gate did consult the table. Here the tombstone is the
   * only thing that exists: a row is written directly for a key that was never
   * claimed, by nobody, and then that key is claimed. A claim gate that read
   * this table — a cooldown switched on without a new ADR, a stale row nobody
   * swept — would refuse it.
   *
   * It doubles as the anti-vacuity check
   * [#83](https://github.com/joshstothard/3moji/issues/83) earned: `recordRelease`
   * is called on its own and the row is read back, so no end-to-end assertion
   * here can be green with the write never having run.
   */
  it("claims a Handle that a stale tombstone names, because nothing reads it", async () => {
    const key = handleKeyFromSet(HANDLE_KEY_LENGTH * 20);
    const email = addressFor("stale-tombstone");
    // The write, called directly and read back: proof the row is real.
    await releaseTransactionOn(db).recordRelease({
      key,
      releasedAt: new Date("2020-01-01T00:00:00.000Z"),
    });
    const written = await tombstonesFor(key);
    expect(written).toHaveLength(1);
    expect(written[0]?.key).toBe(key);
    // Nobody ever claimed it, so the row is as stale as a row can be.
    expect(await countHandles(key)).toBe("0");

    const result = await claim({ segment: key, email });

    expect(result.state).toBe("held");
    expect(await countHandles(key)).toBe("1");
  });

  /**
   * **Release, reclaim, release again — two tombstones for one key.**
   *
   * This is why `key` is not the primary key, and it is a correctness case
   * rather than a schema preference: with a primary key on `key`, the second
   * Release would raise `23505` *inside its own transaction* and a legitimate
   * account deletion would become impossible. Dropping the cooldown is exactly
   * what makes this history reachable.
   */
  it("records a second tombstone when a reclaimed Handle is released again", async () => {
    const key = handleKeyFromSet(HANDLE_KEY_LENGTH * 21);
    const first = addressFor("twice-first");
    const second = addressFor("twice-second");
    await claim({ segment: key, email: first });
    await release(await userIdOf(first));
    await claim({ segment: key, email: second, clock: reclaimClock });

    const result = await release(await userIdOf(second), {
      now: () => new Date("2026-09-13T09:00:00.000Z"),
    });

    expect(result.state).toBe("released");
    const tombstones = await tombstonesFor(key);
    expect(tombstones).toHaveLength(2);
    // Two rows, two distinct ids, one key: the history the table exists to keep.
    expect(new Set(tombstones.map((row) => row.id)).size).toBe(2);
    expect(await countUsers(first)).toBe("0");
    expect(await countUsers(second)).toBe("0");
  });

  /**
   * Nothing to release: no live Account owns a Handle under this id. The
   * transaction rolls back, so no tombstone is left for a Handle the Release
   * could not name.
   */
  it("writes nothing for an id that owns no Handle", async () => {
    const before = await db.execute<{ count: string }>(
      sql`SELECT count(*) AS count FROM "released_handle"`,
    );

    const result = await release(`${SUITE_TAG}-nobody`);

    expect(result).toEqual({ state: "no-handle" });
    const after = await db.execute<{ count: string }>(
      sql`SELECT count(*) AS count FROM "released_handle"`,
    );
    expect((after.rows as { count: string }[])[0]?.count).toBe(
      (before.rows as { count: string }[])[0]?.count,
    );
  });

  /**
   * The column the tombstone cannot do without, refused by the database itself.
   *
   * A tombstone with no key records nothing — it is a timestamp attached to
   * nothing — so `NOT NULL` is the constraint that makes the row worth keeping.
   * The **SQLSTATE** is asserted rather than "it threw": only the code
   * distinguishes a rejected insert from a connection drop or a typo in the
   * SQL, and `postgresErrorCode` walks the `cause` chain Drizzle wraps the
   * driver's error in.
   */
  it("refuses a tombstone with no key, and says so with 23502", async () => {
    const failure = await db
      .execute(
        sql`INSERT INTO "released_handle" (id, released_at) VALUES (${`${SUITE_TAG}-keyless`}, ${RELEASED_AT})`,
      )
      .then(() => "resolved")
      .catch((error: unknown) => postgresErrorCode(error));

    expect(failure).toBe(NOT_NULL_VIOLATION);
  });
});
