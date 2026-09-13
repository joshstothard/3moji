import path from "node:path";

import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";

import {
  claimTransactionOn,
  createDrizzleClaimStore,
} from "../adapters/drizzle-claim-store";
import { createDrizzleAccountDirectory } from "../adapters/drizzle-account-directory";
import { createInMemoryVerificationDispatchStore } from "../adapters/in-memory-verification-dispatch-store";
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
import { submitClaim } from "./submit-claim";
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

/** An hour after a hold taken at `NOW` died: 25 hours later. */
const pastExpiry: Clock = {
  now: () => new Date("2026-09-13T13:00:00.000Z"),
};
/** A fresh 24-hour hold taken at {@link pastExpiry}. */
const PAST_EXPIRY_HELD_UNTIL = "2026-09-14T13:00:00.000Z";
/** Verification, as #82 will write it. */
const CLAIMED_AT = new Date("2026-09-12T12:30:00.000Z");
/** A `held_until` far enough back that only `claimed_at` can save the row. */
const LONG_PAST = new Date("2020-01-01T00:00:00.000Z");

/** Every Account this suite creates carries this tag, and only these are deleted. */
const SUITE_TAG = `claim-int-${String(Date.now())}`;
const addressFor = (name: string): string => `${SUITE_TAG}-${name}@example.com`;
/**
 * The same address as {@link addressFor}, typed with capitals — the way a
 * phone keyboard capitalises an email field (#163).
 *
 * Only the part **after** `SUITE_TAG` changes case, so a row stored under the
 * lowercased address still matches the `LIKE` cleanup below.
 */
const mixedCaseAddressFor = (name: string): string =>
  `${SUITE_TAG}-${name.toUpperCase()}@Example.COM`;

/** The `message` of an unknown rejection, without a cross-realm `instanceof`. */
const messageOf = (error: unknown): string =>
  typeof error === "object" &&
  error !== null &&
  "message" in error &&
  typeof error.message === "string"
    ? error.message
    : String(error);

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
    /** Moves time for the lazy-expiry cases. Never a sleep. */
    clock?: Clock;
  }): Promise<ClaimResult> =>
    claimHandle({
      segment: input.segment,
      email: input.email,
      password: PASSWORD,
      store: input.store ?? store,
      clock: input.clock ?? fixedClock,
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
   * Two Claims with the **same address** at the same time, for different
   * Handles. Neither transaction can see the other's uncommitted `user` row, so
   * both reach the insert and `user.email`'s unique index decides.
   *
   * **This asserts the invariant, not the loser's response.** Exactly one
   * Account exists and at most one hold was written, which is what ADR-0004
   * decision 4 promises. Whether the loser is told `already-registered` or gets
   * a genuine error depends on whether Better Auth surfaces the unique
   * violation or swallows it, and pinning a coin-flip would make this flaky
   * rather than informative. The adapter handles the surfaced case; the other
   * fails loudly on purpose.
   */
  it("creates exactly one Account when two Claims race with the same address", async () => {
    const email = addressFor("race-same-email");
    const first = handleKeyFromSet(HANDLE_KEY_LENGTH * 7);
    const second = handleKeyFromSet(HANDLE_KEY_LENGTH * 8);

    await Promise.allSettled([
      claim({ segment: first, email }),
      claim({ segment: second, email }),
    ]);

    expect(await countUsers(email)).toBe("1");
    const holds = [await countHandles(first), await countHandles(second)];
    expect(holds.filter((count) => count === "1").length).toBeLessThanOrEqual(
      1,
    );
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
  /**
   * **ADR-0004 decision 3's write side, against a real Postgres.**
   *
   * Time moves through the injected `Clock` — never a `sleep`, and never
   * `now()` in SQL — so an expired hold is a Claim made at `NOW` re-attempted
   * at `PAST_EXPIRY`. The expired row is freed and the newcomer takes the
   * Handle in one transaction, and freeing it **deleted the unverified
   * Account** (decision 5's last sentence): the first address has no `user`
   * row afterwards.
   */
  it("frees an expired hold and lets someone else claim the Handle", async () => {
    const key = handleKeyFromSet(HANDLE_KEY_LENGTH * 9);
    const first = addressFor("expired-loser");
    const second = addressFor("expired-winner");
    await claim({ segment: key, email: first });
    const abandoned = await userRow(first);
    expect(abandoned).toBeDefined();
    emailSender.clear();

    const result = await claim({
      segment: key,
      email: second,
      clock: pastExpiry,
    });

    expect(result.state).toBe("held");
    // The unverified Account went with the hold.
    expect(await countUsers(first)).toBe("0");
    const winner = await userRow(second);
    const hold = await holdRow(key);
    expect(await countHandles(key)).toBe("1");
    expect(hold?.user_id).toBe(winner?.id);
    expect(hold?.claimed_at).toBeNull();
    expect(emailSender.sent).toHaveLength(1);
  });

  /**
   * The same person, coming back after their own hold died. This is the case
   * the **ordering** inside the transaction exists for: the freeing write
   * deletes the Account holding that address, so the `createAccount` read that
   * follows finds the address free. A freeing write placed after it would
   * answer `already-registered` and the submitter could never reclaim their
   * own expired Handle.
   */
  it("lets the same address reclaim its own expired hold", async () => {
    const key = handleKeyFromSet(HANDLE_KEY_LENGTH * 10);
    const email = addressFor("expired-same-address");
    const before = await claim({ segment: key, email });
    expect(before.state).toBe("held");
    const first = await userRow(email);
    emailSender.clear();

    const result = await claim({ segment: key, email, clock: pastExpiry });

    expect(result.state).toBe("held");
    // Exactly one Account for the address, and it is a *new* one: the old row
    // was deleted, not reused.
    expect(await countUsers(email)).toBe("1");
    const second = await userRow(email);
    expect(second?.id).not.toBe(first?.id);
    const hold = await holdRow(key);
    expect(hold?.user_id).toBe(second?.id);
    expect(new Date(hold?.held_until ?? 0).toISOString()).toBe(
      PAST_EXPIRY_HELD_UNTIL,
    );
    expect(emailSender.sent).toHaveLength(1);
  });

  /**
   * A hold that has not expired yet is refused, and nothing is written. Time
   * has moved — but only to one second before `held_until`, which is the
   * boundary the read-side rule is defined on.
   */
  it("refuses a Claim on a hold that has not expired yet", async () => {
    const key = handleKeyFromSet(HANDLE_KEY_LENGTH * 11);
    const first = addressFor("not-yet-first");
    const second = addressFor("not-yet-second");
    await claim({ segment: key, email: first });
    const owner = await userRow(first);
    emailSender.clear();

    const result = await claim({
      segment: key,
      email: second,
      clock: { now: () => new Date(new Date(HELD_UNTIL).getTime() - 1000) },
    });

    if (result.state !== "taken") throw new Error(`got ${result.state}`);
    expect(result.because).toBe("held");
    // The hold is untouched: same Account, same row, nothing freed.
    expect(await countUsers(first)).toBe("1");
    expect(await countUsers(second)).toBe("0");
    expect((await holdRow(key))?.user_id).toBe(owner?.id);
    expect(emailSender.sent).toHaveLength(0);
  });

  /**
   * The boundary instant itself, against the database rather than in the pure
   * rule. `ownershipOf` treats `held_until == now` as already expired —
   * twenty-four hours means twenty-four hours — so the SQL predicate behind
   * the freeing write has to be `held_until <= now`, not `<`. This is the one
   * case where an off-by-one between the two encodings of the same rule shows
   * up, and it mirrors the read-side test in `handle-ownership.test.ts`.
   */
  it("treats the expiry instant itself as expired", async () => {
    const key = handleKeyFromSet(HANDLE_KEY_LENGTH * 12);
    const first = addressFor("boundary-first");
    const second = addressFor("boundary-second");
    await claim({ segment: key, email: first });

    const result = await claim({
      segment: key,
      email: second,
      clock: { now: () => new Date(HELD_UNTIL) },
    });

    expect(result.state).toBe("held");
    expect(await countUsers(first)).toBe("0");
  });

  /**
   * **A verified Account's Handle is never freed, whatever `held_until`
   * says** — the criterion the issue is most emphatic about, proved here
   * against the row rather than through the domain read.
   *
   * `claimed_at` is set directly, which is what #82's verification will do,
   * and `held_until` is left far in the past. A predicate that read the
   * timestamp alone would delete a real owner's Account.
   */
  it("never frees a verified Account's Handle, however long ago held_until passed", async () => {
    const key = handleKeyFromSet(HANDLE_KEY_LENGTH * 13);
    const owner = addressFor("verified-owner");
    const intruder = addressFor("verified-intruder");
    await claim({ segment: key, email: owner });
    const ownerRow = await userRow(owner);
    // Verification, as #82 will perform it: the Claim becomes final.
    await db.execute(
      sql`UPDATE "handle" SET claimed_at = ${CLAIMED_AT}, held_until = ${LONG_PAST} WHERE key = ${key}`,
    );
    emailSender.clear();

    const result = await claim({
      segment: key,
      email: intruder,
      clock: pastExpiry,
    });

    if (result.state !== "taken") throw new Error(`got ${result.state}`);
    expect(result.because).toBe("claimed");
    expect(await countUsers(owner)).toBe("1");
    expect(await countUsers(intruder)).toBe("0");
    const hold = await holdRow(key);
    expect(hold?.user_id).toBe(ownerRow?.id);
    expect(hold?.claimed_at).not.toBeNull();
    expect(emailSender.sent).toHaveLength(0);
  });

  /**
   * **The one new concurrency shape this write introduces**: two Claims racing
   * for the same Handle when the row sitting there is an *expired* hold, so
   * both want to delete the same `user` row before inserting their own.
   *
   * Both are issued before either is awaited, each on its own pooled
   * connection in its own transaction, and they name different emails so a
   * rejection can only have come from the Handle's primary key. The loser's
   * `SELECT … FOR UPDATE` waits on the winner's row lock; when the winner
   * commits its DELETE, the waiter re-evaluates the predicate, finds no row,
   * and goes on to its own INSERT, which the primary key then refuses. So the
   * shape terminates in one `held` and one `taken` rather than deadlocking —
   * and `statement_timeout` on the pool means a bug here fails CI instead of
   * wedging it.
   */
  it("leaves one row when two Claims race for the same expired Handle", async () => {
    const key = handleKeyFromSet(HANDLE_KEY_LENGTH * 15);
    const abandoned = addressFor("expired-race-abandoned");
    const first = addressFor("expired-race-first");
    const second = addressFor("expired-race-second");
    await claim({ segment: key, email: abandoned });
    emailSender.clear();

    const settled = await Promise.all([
      claim({ segment: key, email: first, clock: pastExpiry }),
      claim({ segment: key, email: second, clock: pastExpiry }),
    ]);

    expect(settled.filter((result) => result.state === "held")).toHaveLength(1);
    expect(settled.filter((result) => result.state === "taken")).toHaveLength(
      1,
    );
    // The expired Account is gone, exactly one of the two newcomers has one,
    // and the Handle is held once.
    expect(await countUsers(abandoned)).toBe("0");
    const users = [await countUsers(first), await countUsers(second)];
    expect(users.filter((count) => count === "1")).toHaveLength(1);
    expect(await countHandles(key)).toBe("1");
    expect(emailSender.sent).toHaveLength(1);
  });

  /**
   * The same guarantee, one layer lower: the **freeing write's own predicate**,
   * called directly rather than through the Claim.
   *
   * The test above passes even if `claimed_at IS NULL` were dropped from the
   * SQL, because the availability read answers `claimed` and the Claim never
   * asks the write to run. This one asks it to run, on exactly the row a
   * timestamp-only predicate would delete, and asserts it refuses. That is
   * ADR-0004's defence in depth rather than its happy path, and it is why
   * `claimTransactionOn` is exported.
   */
  it("refuses to free a claimed row even when asked directly", async () => {
    const key = handleKeyFromSet(HANDLE_KEY_LENGTH * 14);
    const email = addressFor("verified-direct");
    await claim({ segment: key, email });
    await db.execute(
      sql`UPDATE "handle" SET claimed_at = ${CLAIMED_AT}, held_until = ${LONG_PAST} WHERE key = ${key}`,
    );

    const outcome = await db.transaction((tx) =>
      claimTransactionOn(
        tx,
        createAuth({
          db: tx,
          emailSender,
          // Nothing here issues a verification link, so an in-memory store is
          // the honest collaborator: it records what it is given and reaches no
          // database. #82's own suite covers the recording itself.
          dispatches: createInMemoryVerificationDispatchStore(),
          clock: pastExpiry,
          baseUrl: "http://localhost:3000",
          secret: "integration-test-secret-of-sufficient-length",
          from: "3moji <no-reply@mail.3moji.me>",
        }),
      ).freeExpiredHold(key, pastExpiry.now()),
    );

    expect(outcome).toEqual({ freed: false });
    expect(await countUsers(email)).toBe("1");
    expect(await countHandles(key)).toBe("1");
  });

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

  /**
   * **#163 (a): a mixed-case new address.** Better Auth lowercases every
   * address it stores, so a Claim that looked the address up as typed would
   * never find the row Better Auth had just written. The Account must exist
   * under the lowercased address and not the typed one — `countUsers` compares
   * bytes, which is what makes the second assertion mean something.
   */
  it("claims a mixed-case new address and stores it lowercased (#163)", async () => {
    const key = handleKeyFromSet(HANDLE_KEY_LENGTH * 40);
    const typed = mixedCaseAddressFor("mixed-new");
    const stored = addressFor("mixed-new");

    const result = await claim({ segment: key, email: typed });

    expect(result.state).toBe("held");
    expect(await countUsers(stored)).toBe("1");
    expect(await countUsers(typed)).toBe("0");
    expect((await holdRow(key))?.user_id).toBe((await userRow(stored))?.id);
    expect(emailSender.lastSent()?.to).toBe(stored);
  });

  /**
   * **#163 (b): a mixed-case variant of an existing address.** It is the same
   * Account to Better Auth, so it must be the same Account to the Claim:
   * `already-registered`, no second Account, and the wanted Handle left free.
   */
  it("treats a mixed-case variant of an existing address as that address (#163)", async () => {
    const owned = handleKeyFromSet(HANDLE_KEY_LENGTH * 41);
    const wanted = handleKeyFromSet(HANDLE_KEY_LENGTH * 42);
    const stored = addressFor("mixed-existing");
    await claim({ segment: owned, email: stored });
    emailSender.clear();

    const result = await claim({
      segment: wanted,
      email: mixedCaseAddressFor("mixed-existing"),
    });

    expect(result.state).toBe("already-registered");
    expect(await countUsers(stored)).toBe("1");
    expect(await countHandles(owned)).toBe("1");
    expect(await countHandles(wanted)).toBe("0");
    expect(emailSender.sent).toHaveLength(0);
  });

  /**
   * **#163's non-enumeration criterion, against the real database.** A
   * mixed-case variant of a registered address must be indistinguishable from
   * the address itself: the same answer, the same response floor, and the
   * existing owner told in both cases. Everything observable is compared as one
   * value, so a difference anywhere fails the test.
   *
   * Both submissions ask for the **same** Handle, which neither ends up
   * holding, so even the Handle in the answer is the same.
   */
  it("answers a mixed-case variant of a registered address exactly as the address itself (#163)", async () => {
    const owned = handleKeyFromSet(HANDLE_KEY_LENGTH * 43);
    const wanted = handleKeyFromSet(HANDLE_KEY_LENGTH * 44);
    const stored = addressFor("mixed-collision");
    await claim({ segment: owned, email: stored });
    const directory = createDrizzleAccountDirectory(db);

    const observe = async (email: string) => {
      emailSender.clear();
      const slept: number[] = [];
      let answer: unknown;
      try {
        answer = await submitClaim({
          segment: wanted,
          email,
          password: PASSWORD,
          store,
          clock: fixedClock,
          directory,
          emailSender,
          resetRequestUrl: "http://localhost:3000/reset-password",
          from: "3moji <no-reply@mail.3moji.me>",
          // Not the limit under test here; that is
          // `claim-rate-limit.integration.test.ts` (#157).
          rateLimiter: { admit: () => Promise.resolve("admitted") },
          clientAddress: undefined,
          sleep: (ms) => {
            slept.push(ms);
            return Promise.resolve();
          },
        });
      } catch (error) {
        answer = { threw: messageOf(error) };
      }
      return {
        answer,
        slept,
        mailedTo: emailSender.sent.map((sent) => sent.to),
      };
    };

    const lowercase = await observe(stored);
    const mixedCase = await observe(mixedCaseAddressFor("mixed-collision"));

    // The baseline really is the collision path: pending, padded to the
    // floor, and the owner mailed at their stored address.
    expect(lowercase.answer).toMatchObject({ state: "pending" });
    expect(lowercase.slept).toHaveLength(1);
    expect(lowercase.mailedTo).toEqual([stored]);
    expect(mixedCase).toEqual(lowercase);
    expect(await countUsers(stored)).toBe("1");
    expect(await countHandles(wanted)).toBe("0");
  });
});
