import path from "node:path";

import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";

import { createDrizzleClaimStore } from "../adapters/drizzle-claim-store";
import { createRecordingEmailSender } from "../auth/adapters/recording-email-sender";
import type { AuthFactory } from "../auth/auth-factory";
import { createAuth } from "../auth/create-auth";
import {
  HANDLE_KEY_LENGTH,
  toHandleKey,
  type HandleKey,
} from "../db/handle-key";
import { authSchema } from "../db/schema";
import { releasedEmojiSet } from "../emoji/emoji-set";
import type { Clock } from "../ports/clock";
import type { ClaimStore } from "../ports/claim-store";
import { claimHandle, type ClaimResult } from "./claim-handle";
import type {
  ReservedHandleEntry,
  ReservedHandleList,
} from "./reserved-handles";

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
const PASSWORD = "correct horse battery staple";
const NOW = new Date("2026-09-12T12:00:00.000Z");
const HELD_UNTIL = "2026-09-13T12:00:00.000Z";
const fixedClock: Clock = { now: () => NOW };

/** Every Account this suite creates carries this tag, and only these are deleted. */
const SUITE_TAG = `claim-int-${String(Date.now())}`;
const addressFor = (name: string): string => `${SUITE_TAG}-${name}@example.com`;

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
  return key;
}

/**
 * The Claim against a real Postgres.
 *
 * **These tests never drop a schema or a table** — a misaimed `DATABASE_URL`
 * would become data loss. Every Account they create carries `SUITE_TAG` in its
 * email and only those are deleted; their Handles go with them, through the
 * cascade `handle.user_id` already declares.
 *
 * What only a real database can prove, and why each of these is here rather
 * than in the unit suite:
 *
 * - **Atomicity.** Two rows in two tables, written by two different pieces of
 *   code — Better Auth's adapter and ours — either both land or neither does.
 *   A fake store cannot fail to be atomic.
 * - **The race.** ADR-0004 decision 7 says the database constraint "is what
 *   decides a race between simultaneous claims". Only Postgres can decide it.
 * - **The middle layer inside a genuine transaction.** The unit suite proves
 *   the *call ordering*; this proves that when the list changes after a real
 *   `BEGIN`, the real transaction rolls back and the rows are not there.
 */
describeWithDatabase("the Claim against a real Postgres", () => {
  let pool: Pool;
  let db: ReturnType<typeof drizzle<typeof authSchema>>;
  let emailSender: ReturnType<typeof createRecordingEmailSender>;
  let store: ClaimStore;

  const claim = (input: {
    segment: string;
    email: string;
    store?: ClaimStore;
    list?: ReservedHandleList;
  }): Promise<ClaimResult> =>
    claimHandle({
      segment: input.segment,
      email: input.email,
      password: PASSWORD,
      store: input.store ?? store,
      clock: fixedClock,
      ...(input.list === undefined ? {} : { list: input.list }),
    });

  const userRow = async (email: string) => {
    const result = await db.execute<{ id: string; email_verified: boolean }>(
      sql`SELECT id, email_verified FROM "user" WHERE email = ${email}`,
    );
    return (result.rows as { id: string; email_verified: boolean }[])[0];
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

  const holdRow = async (key: string) => {
    const result = await db.execute<{
      held_until: Date;
      claimed_at: Date | null;
      user_id: string;
    }>(
      sql`SELECT held_until, claimed_at, user_id FROM "handle" WHERE key = ${key}`,
    );
    return (
      result.rows as {
        held_until: Date;
        claimed_at: Date | null;
        user_id: string;
      }[]
    )[0];
  };

  const sessionCount = async (userId: string): Promise<number> => {
    const result = await db.execute<{ count: string }>(
      sql`SELECT count(*) AS count FROM "session" WHERE user_id = ${userId}`,
    );
    return Number((result.rows as { count: string }[])[0]?.count ?? "-1");
  };

  const removeOwnRows = async (): Promise<void> => {
    await db.execute(
      sql`DELETE FROM "user" WHERE email LIKE ${`${SUITE_TAG}%`}`,
    );
  };

  beforeAll(async () => {
    // Built by hand rather than through createDatabase for two reasons: the
    // migrator needs the concrete node-postgres type rather than the union, and
    // `statement_timeout` has to be set. The race below has one INSERT waiting
    // on another transaction's index entry, and a bug that stopped the winner
    // committing would otherwise wedge CI rather than fail it.
    pool = new Pool({
      connectionString: url,
      options: "-c statement_timeout=10000",
    });
    db = drizzle(pool, { schema: authSchema });
    // Idempotent, so it does not matter whether another suite migrated first.
    await migrate(db, { migrationsFolder: MIGRATIONS });
    await removeOwnRows();

    emailSender = createRecordingEmailSender();
    const auth: AuthFactory = ({ db: client, emailSender: sender }) =>
      createAuth({
        db: client,
        emailSender: sender,
        baseUrl: "http://localhost:3000",
        secret: "integration-test-secret-of-sufficient-length",
        from: "3moji <no-reply@mail.3moji.me>",
      });
    store = createDrizzleClaimStore({ db, auth, emailSender });
  });

  afterAll(async () => {
    await removeOwnRows();
    await pool.end();
  });

  beforeEach(() => {
    emailSender.clear();
  });

  it("creates the Account and holds the Handle, both or neither", async () => {
    const key = handleKeyFromSet(0);
    const email = addressFor("happy");

    const result = await claim({ segment: key, email });

    expect(result.state).toBe("held");
    const user = await userRow(email);
    expect(user).toBeDefined();
    const hold = await holdRow(key);
    expect(hold?.user_id).toBe(user?.id);
    // From the injected Clock, not from now() + interval: the column has no
    // SQL default on purpose (ADR-0004 decision 3).
    expect(new Date(hold?.held_until ?? 0).toISOString()).toBe(HELD_UNTIL);
    // claimed_at IS NULL is what "still held" means.
    expect(hold?.claimed_at).toBeNull();
  });

  it("issues no session and sends the verification email once", async () => {
    const key = handleKeyFromSet(HANDLE_KEY_LENGTH);
    const email = addressFor("no-session");

    await claim({ segment: key, email });

    const user = await userRow(email);
    expect(user?.email_verified).toBe(false);
    // requireEmailVerification is on, so the Claim is not final yet (#15).
    expect(await sessionCount(user?.id ?? "")).toBe(0);
    expect(emailSender.sent).toHaveLength(1);
    expect(emailSender.lastSent()?.to).toBe(email);
    // The tokenised URL Better Auth supplies, sent after the commit.
    expect(emailSender.lastSent()?.text).toContain("token=");
  });

  /**
   * A Handle taken between picking and submitting. The Account and the hold are
   * one act, so **nothing** is created — not the Account, and no email.
   */
  it("creates nothing when the Handle is already held by someone else", async () => {
    const key = handleKeyFromSet(HANDLE_KEY_LENGTH * 2);
    const first = addressFor("taken-first");
    const second = addressFor("taken-second");
    await claim({ segment: key, email: first });
    emailSender.clear();

    const result = await claim({ segment: key, email: second });

    if (result.state !== "taken") throw new Error(`got ${result.state}`);
    expect(result.because).toBe("held");
    expect(await countUsers(second)).toBe("0");
    expect(await countHandles(key)).toBe("1");
    expect(emailSender.sent).toHaveLength(0);
  });

  /**
   * **ADR-0004 decision 7's middle layer, inside a genuine transaction.**
   *
   * The Handle becomes Reserved after the real `BEGIN` has been issued — which
   * is past the point a naive implementation would have read the list, and
   * before the INSERT the read guards. The rows are then checked directly: the
   * transaction must have rolled back, so neither the Account nor the hold is
   * there.
   */
  it("rolls back when the Handle is reserved after its transaction opened", async () => {
    const key = handleKeyFromSet(HANDLE_KEY_LENGTH * 3);
    const email = addressFor("reserved-mid-flight");
    let entries: readonly ReservedHandleEntry[] = [];
    const list: ReservedHandleList = {
      blocked: [],
      get entries() {
        return entries;
      },
    };
    // Reserves the Handle the instant the real transaction opens, before the
    // work inside it has run.
    const reservingAfterBegin: ClaimStore = {
      runInTransaction: (work) =>
        store.runInTransaction((tx) => {
          entries = [
            {
              key,
              scope: "platform",
              why: "reserved after BEGIN by this test",
            },
          ];
          return work(tx);
        }),
    };

    const result = await claim({
      segment: key,
      email,
      store: reservingAfterBegin,
      list,
    });

    if (result.state !== "not-claimable")
      throw new Error(`got ${result.state}`);
    expect(result.caughtBy).toBe("transaction");
    expect(await countUsers(email)).toBe("0");
    expect(await countHandles(key)).toBe("0");
    expect(emailSender.sent).toHaveLength(0);
  });

  /**
   * The acceptance criterion that needs real concurrency: **both Claims are in
   * flight at once**, each in its own transaction on its own pooled connection,
   * and both are issued before either is awaited. They name different emails,
   * so a rejection can only have come from the Handle's primary key and not
   * from the unique `user_id` or the unique email.
   *
   * The loser's INSERT waits on the winner's uncommitted index entry until the
   * winner's transaction ends — which it does as soon as its own work returns,
   * independently of this test — so the race terminates rather than deadlocks.
   */
  it("leaves exactly one row when two Claims race for the same Handle", async () => {
    const key = handleKeyFromSet(HANDLE_KEY_LENGTH * 4);
    const first = addressFor("race-first");
    const second = addressFor("race-second");

    const settled = await Promise.all([
      claim({ segment: key, email: first }),
      claim({ segment: key, email: second }),
    ]);

    expect(settled.filter((result) => result.state === "held")).toHaveLength(1);
    const losers = settled.filter((result) => result.state === "taken");
    expect(losers).toHaveLength(1);
    expect(await countHandles(key)).toBe("1");
    // The loser created nothing at all, which is the invariant: exactly one of
    // the two addresses has an Account.
    const users = [await countUsers(first), await countUsers(second)];
    expect(users.filter((count) => count === "1")).toHaveLength(1);
    expect(emailSender.sent).toHaveLength(1);
  });

  /**
   * #15's already-registered path. The submitter must not be able to learn that
   * the address exists, and the Handle they typed must stay free rather than be
   * held for somebody else's Account.
   *
   * The "someone tried to sign up" email to the existing address, naming the
   * Handle they own and carrying a reset link, is #82's: it is composed email
   * copy that needs a reset token from Better Auth's reset flow, not a write.
   */
  it("creates nothing when the email already has an Account", async () => {
    const email = addressFor("duplicate");
    const owned = handleKeyFromSet(HANDLE_KEY_LENGTH * 5);
    const wanted = handleKeyFromSet(HANDLE_KEY_LENGTH * 6);
    await claim({ segment: owned, email });
    emailSender.clear();

    const result = await claim({ segment: wanted, email });

    expect(result.state).toBe("already-registered");
    expect(await countUsers(email)).toBe("1");
    // Their existing Handle is untouched, and the one they asked for is free.
    expect(await countHandles(owned)).toBe("1");
    expect(await countHandles(wanted)).toBe("0");
    expect(emailSender.sent).toHaveLength(0);
  });
});
