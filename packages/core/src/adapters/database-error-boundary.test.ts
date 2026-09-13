import { drizzle } from "drizzle-orm/node-postgres";
import { Client, DatabaseError, Pool } from "pg";

import { createRecordingEmailSender } from "../auth/adapters/recording-email-sender";
import type { AuthFactory } from "../auth/auth-factory";
import { createAuth } from "../auth/create-auth";
import { createDatabase, type Database } from "../db/client";
import { toHandleKey } from "../db/handle-key";
import { postgresErrorCode } from "../db/postgres-error";
import { authSchema } from "../db/schema";

import { createDrizzleAccountDirectory } from "./drizzle-account-directory";
import { createDrizzleClaimFinaliser } from "./drizzle-claim-finaliser";
import { createDrizzleClaimStore } from "./drizzle-claim-store";
import { createDrizzleHandleRepository } from "./drizzle-handle-repository";
import { createDrizzleProfileRepository } from "./drizzle-profile-repository";
import { createDrizzleProfileStore } from "./drizzle-profile-store";
import { createDrizzleReleaseStore } from "./drizzle-release-store";
import { createDrizzleVerificationDispatchStore } from "./drizzle-verification-dispatch-store";

/**
 * **No bound query parameter leaves a `packages/core` adapter inside an error**
 * ([#144](https://github.com/joshstothard/3moji/issues/144)).
 *
 * drizzle-orm 0.45.2 reports a failed statement as a `DrizzleQueryError` whose
 * message is `Failed query: <sql>\nparams: <params>`, which keeps `query` and
 * `params` as own enumerable properties (so `JSON.stringify` repeats them), and
 * keeps the `pg` error in `cause` — whose `detail` can read
 * `Key (email)=(someone@example.com) already exists.` An error tracker captures
 * all of that by default. What leaves an adapter must carry none of it, and
 * must still carry the SQLSTATE the domain branches on.
 *
 * **Every error here is a real one**, raised by drizzle-orm itself rather than
 * built to look like one: the query-only adapters are pointed at a closed port,
 * so drizzle wraps the refused connection with the address really bound; the
 * transactional stores are given a pool whose client answers `begin` and then
 * rejects the first statement with a genuine `pg` `DatabaseError`.
 */

const EMAIL = "someone@example.com";
const PASSWORD = "hunter2-Tr0ub4dor&3";
const DISPLAY_NAME = "Ada Lovelace-Byron";
const BIO = "Analyst of the Engine, poet of science";
const LINK_TITLE = "My private notebook";
const LINK_URL = "https://example.com/ada-private-notebook";
const USER_ID = "user-id-3f9a1c7e";
const TOKEN_HASH =
  "b1946ac92492d2347c6235b4d2611184aa3f1b6e0c3b8d1a2f4e5d6c7b8a9f00";

const CLOSED_PORT_URL = "postgresql://app:app@127.0.0.1:59999/app_test";

/** The pg error Postgres raises for a duplicate address, with its real fields. */
function uniqueViolation(): DatabaseError {
  const error = new DatabaseError(
    'duplicate key value violates unique constraint "user_email_unique"',
    0,
    "error",
  );
  error.severity = "ERROR";
  error.code = "23505";
  error.detail = `Key (email)=(${EMAIL}) already exists.`;
  error.table = "user";
  error.constraint = "user_email_unique";
  error.routine = "_bt_check_unique";
  return error;
}

/**
 * A pool whose one client answers the transaction's own statements and rejects
 * everything else with {@link uniqueViolation}, so drizzle-orm raises a real
 * `DrizzleQueryError` carrying the statement's real parameters.
 *
 * `Object.defineProperty` rather than a subclass or `jest.spyOn`: `connect`
 * and `query` are overloaded in `@types/pg`, and neither can be reimplemented
 * without a cast, which this package forbids.
 */
function scriptedDatabase(): Database {
  const client = new Client();
  Object.defineProperty(client, "query", {
    value: (config: unknown) => {
      const text =
        typeof config === "object" && config !== null && "text" in config
          ? config.text
          : config;
      if (text === "begin" || text === "rollback" || text === "commit") {
        return Promise.resolve({ rows: [], fields: [], rowCount: 0 });
      }
      return Promise.reject(uniqueViolation());
    },
  });
  Object.defineProperty(client, "release", { value: () => undefined });

  const pool = new Pool();
  Object.defineProperty(pool, "connect", {
    value: () => Promise.resolve(client),
  });
  return drizzle(pool, { schema: authSchema });
}

const authFactory: AuthFactory = ({ db, emailSender, dispatches }) =>
  createAuth({
    db,
    emailSender,
    dispatches,
    clock: { now: () => new Date("2026-09-13T12:00:00.000Z") },
    baseUrl: "http://localhost:3000",
    secret: "a".repeat(32),
    from: "3moji <no-reply@mail.3moji.me>",
  });

/**
 * Every rendering of an error a tracker or a log could capture — `message`,
 * `String()`, `stack` and `JSON.stringify` — for the error and every link down
 * its `cause` chain.
 */
function everythingSaidBy(error: unknown): string {
  const said: string[] = [];
  let current: unknown = error;
  for (let depth = 0; depth < 8 && current !== undefined; depth += 1) {
    if (typeof current !== "object" || current === null) {
      said.push(JSON.stringify(current));
      break;
    }
    // What `String(error)` renders for an Error, without trusting the value to
    // be one.
    said.push(Error.prototype.toString.call(current));
    try {
      said.push(JSON.stringify(current));
    } catch {
      said.push("<unserialisable>");
    }
    if ("message" in current) said.push(String(current.message));
    if ("stack" in current) said.push(String(current.stack));
    current = "cause" in current ? current.cause : undefined;
  }
  return said.join("\n");
}

/** A property of the error itself — not of anything down its chain. */
function ownProperty(error: unknown, name: string): unknown {
  return typeof error === "object" && error !== null && name in error
    ? Reflect.get(error, name)
    : undefined;
}

async function rejectionOf(work: Promise<unknown>): Promise<unknown> {
  try {
    await work;
  } catch (error) {
    return error;
  }
  throw new Error("expected the adapter to reject, and it resolved.");
}

function expectNothingBound(error: unknown, secrets: readonly string[]): void {
  const said = everythingSaidBy(error);
  for (const secret of secrets) {
    expect(said).not.toContain(secret);
  }
}

describe("errors leaving a transactional store (#144)", () => {
  it("carry no email address or password from the Claim, and keep the SQLSTATE and constraint", async () => {
    const store = createDrizzleClaimStore({
      db: scriptedDatabase(),
      auth: authFactory,
      emailSender: createRecordingEmailSender(),
    });

    const error = await rejectionOf(
      store.runInTransaction(async (tx) => {
        await tx.createAccount({
          email: EMAIL,
          password: PASSWORD,
          name: "🧊🧊🧊",
        });
        return { commit: true, value: undefined };
      }),
    );

    expectNothingBound(error, [EMAIL, PASSWORD]);
    expect(postgresErrorCode(error)).toBe("23505");
    expect(ownProperty(error, "code")).toBe("23505");
    expect(ownProperty(error, "constraint")).toBe("user_email_unique");
  });

  it("carry no Profile content from a Profile edit", async () => {
    const store = createDrizzleProfileStore({
      db: scriptedDatabase(),
      newId: () => "link-id",
    });

    const error = await rejectionOf(
      store.runInTransaction(async (tx) => {
        await tx.saveProfile({
          userId: USER_ID,
          displayName: DISPLAY_NAME,
          bio: BIO,
          links: [{ title: LINK_TITLE, url: LINK_URL }],
          updatedAt: new Date("2026-09-13T12:00:00.000Z"),
        });
        return { commit: true, value: undefined };
      }),
    );

    expectNothingBound(error, [DISPLAY_NAME, BIO, EMAIL, USER_ID]);
    expect(ownProperty(error, "code")).toBe("23505");
  });

  it("carry no user id from a Release", async () => {
    const store = createDrizzleReleaseStore({ db: scriptedDatabase() });

    const error = await rejectionOf(
      store.runInTransaction(async (tx) => {
        await tx.deleteAccount(USER_ID);
        return { commit: true, value: undefined };
      }),
    );

    expectNothingBound(error, [USER_ID, EMAIL]);
    expect(ownProperty(error, "code")).toBe("23505");
  });

  it("carry no user id from a finalisation", async () => {
    const finaliser = createDrizzleClaimFinaliser({
      db: scriptedDatabase(),
      auth: authFactory,
      emailSender: createRecordingEmailSender(),
    });

    const error = await rejectionOf(
      finaliser.runInTransaction(async (tx) => {
        await tx.finaliseHold(USER_ID, new Date("2026-09-13T12:00:00.000Z"));
        return { commit: true, value: undefined };
      }),
    );

    expectNothingBound(error, [USER_ID, EMAIL]);
    expect(ownProperty(error, "code")).toBe("23505");
  });
});

describe("errors leaving a query-only adapter (#144)", () => {
  const withClosedPort = async (
    run: (db: Database) => Promise<unknown>,
  ): Promise<unknown> => {
    const handle = createDatabase({ url: CLOSED_PORT_URL });
    try {
      return await rejectionOf(run(handle.db));
    } finally {
      await handle.close();
    }
  };

  it("carry no email address from the account directory, and keep the connection code", async () => {
    const error = await withClosedPort((db) =>
      createDrizzleAccountDirectory(db).byEmail(EMAIL),
    );

    expectNothingBound(error, [EMAIL]);
    expect(ownProperty(error, "code")).toBe("ECONNREFUSED");
    expect(postgresErrorCode(error)).toBe("ECONNREFUSED");
  });

  it("carry no user id from the account directory's Handle read", async () => {
    const error = await withClosedPort((db) =>
      createDrizzleAccountDirectory(db).handleOf(USER_ID),
    );

    expectNothingBound(error, [USER_ID]);
    expect(ownProperty(error, "code")).toBe("ECONNREFUSED");
  });

  it("carry no token hash or user id from the verification dispatch store", async () => {
    const errors = await Promise.all([
      withClosedPort((db) =>
        createDrizzleVerificationDispatchStore({ db }).findByTokenHash(
          TOKEN_HASH,
        ),
      ),
      withClosedPort((db) =>
        createDrizzleVerificationDispatchStore({ db }).record({
          userId: USER_ID,
          tokenHash: TOKEN_HASH,
          sentAt: new Date("2026-09-13T12:00:00.000Z"),
        }),
      ),
      withClosedPort((db) =>
        createDrizzleVerificationDispatchStore({ db }).since(
          USER_ID,
          new Date("2026-09-13T12:00:00.000Z"),
        ),
      ),
      withClosedPort((db) =>
        createDrizzleVerificationDispatchStore({ db }).newestFor(USER_ID),
      ),
    ]);

    for (const error of errors) {
      expectNothingBound(error, [TOKEN_HASH, USER_ID]);
      expect(ownProperty(error, "code")).toBe("ECONNREFUSED");
    }
  });

  it("carry no bound Handle key from the Handle and Profile repositories", async () => {
    const key = toHandleKey("\u{1F9CA}\u{1F9CA}\u{1F9CA}");
    if (key === undefined)
      throw new Error("the test key did not canonicalise.");

    const errors = await Promise.all([
      withClosedPort((db) =>
        createDrizzleHandleRepository(db).availabilityOf(key, new Date()),
      ),
      withClosedPort((db) => createDrizzleProfileRepository(db).profileOf(key)),
      withClosedPort((db) =>
        createDrizzleProfileRepository(db).displayNamesOf([key]),
      ),
    ]);

    for (const error of errors) {
      expectNothingBound(error, [key, "params:"]);
      expect(ownProperty(error, "code")).toBe("ECONNREFUSED");
    }
  });
});

describe("what the stores still pass through untouched (#144)", () => {
  it("leaves an error the unit of work threw itself exactly as it was", async () => {
    const store = createDrizzleClaimStore({
      db: scriptedDatabase(),
      auth: authFactory,
      emailSender: createRecordingEmailSender(),
    });
    const own = new Error("the domain's own failure");

    const error = await rejectionOf(
      store.runInTransaction(() => Promise.reject(own)),
    );

    expect(error).toBe(own);
  });
});
