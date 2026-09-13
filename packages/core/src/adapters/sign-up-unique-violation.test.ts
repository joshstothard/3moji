import { format } from "node:util";

import { drizzle } from "drizzle-orm/node-postgres";
import { Client, DatabaseError, Pool } from "pg";

import { createInMemoryVerificationDispatchStore } from "./in-memory-verification-dispatch-store";
import { createRecordingEmailSender } from "../auth/adapters/recording-email-sender";
import { createAuth } from "../auth/create-auth";
import type { Database } from "../db/client";
import { postgresErrorCode } from "../db/postgres-error";
import { authSchema } from "../db/schema";

import { claimTransactionOn } from "./drizzle-claim-store";

/**
 * **What a duplicate address looks like to the Claim once Better Auth has had
 * it** ([#148](https://github.com/joshstothard/3moji/issues/148)).
 *
 * `createAccount` catches `signUpEmail` and answers `email-taken` when the
 * error carries SQLSTATE `23505`. #144's author believed that branch can never
 * see one for the address, because Better Auth wraps its user insert in a catch
 * that throws `APIError(FAILED_TO_CREATE_USER)` instead. This proves it rather
 * than assuming it: the pre-read and Better Auth's own lookup both find nobody
 * — as they do for two Claims racing with one address, neither able to see the
 * other's uncommitted row — and Postgres then rejects the user insert with the
 * real unique violation.
 *
 * **The branch stays.** Better Auth's catch covers only the user insert.
 * `linkAccount` and the `sendVerificationEmail` hook that records the dispatch
 * run after it, outside that catch, so a `23505` from either still reaches
 * `createAccount` with its code — which, since #148, is an own property of the
 * `DatabaseQueryFailed` the adapter wrapper hands on.
 */

const EMAIL = "racing-148@example.com";
const PASSWORD = "hunter2-Tr0ub4dor&3";

function uniqueViolationOnEmail(): DatabaseError {
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
  return error;
}

/**
 * A database on which every read finds nothing and the insert into `user` is
 * rejected by the unique index — the losing side of a same-address race.
 */
function losingRaceDatabase(): { db: Database; statements: string[] } {
  const statements: string[] = [];
  const answer = (config: unknown): Promise<unknown> => {
    const text =
      typeof config === "object" && config !== null && "text" in config
        ? String(config.text)
        : String(config);
    statements.push(text);
    if (text.startsWith('insert into "user"')) {
      return Promise.reject(uniqueViolationOnEmail());
    }
    return Promise.resolve({ rows: [], fields: [], rowCount: 0 });
  };

  const client = new Client();
  Object.defineProperty(client, "query", { value: answer });
  Object.defineProperty(client, "release", { value: () => undefined });

  // Both entry points: a transaction checks a client out with `connect`, and a
  // lone statement goes through `pool.query`, which would otherwise try to open
  // a real connection.
  const pool = new Pool();
  Object.defineProperty(pool, "connect", {
    value: () => Promise.resolve(client),
  });
  Object.defineProperty(pool, "query", { value: answer });
  return { db: drizzle(pool, { schema: authSchema }), statements };
}

describe("a unique violation on the sign-up insert (#148)", () => {
  let printed: string[];
  let spy: jest.SpyInstance;

  beforeEach(() => {
    printed = [];
    spy = jest.spyOn(console, "error").mockImplementation((...args) => {
      printed.push(format(...args));
    });
  });

  afterEach(() => {
    spy.mockRestore();
  });

  it("reaches createAccount as Better Auth's APIError, with no SQLSTATE, so the 23505 branch does not answer it", async () => {
    const { db, statements } = losingRaceDatabase();
    const auth = createAuth({
      db,
      emailSender: createRecordingEmailSender(),
      dispatches: createInMemoryVerificationDispatchStore(),
      clock: { now: () => new Date("2026-09-13T12:00:00.000Z") },
      baseUrl: "http://localhost:3000",
      secret: "a".repeat(32),
      from: "3moji <no-reply@mail.3moji.me>",
    });

    let error: unknown;
    try {
      await claimTransactionOn(db, auth).createAccount({
        email: EMAIL,
        password: PASSWORD,
        name: "🧊🧊🧊",
      });
    } catch (caught) {
      error = caught;
    }

    // The insert really was attempted and really was refused.
    expect(statements.some((s) => s.startsWith('insert into "user"'))).toBe(
      true,
    );
    // Not `{ ok: false, reason: "email-taken" }`: the branch is not taken.
    expect(error).toMatchObject({
      status: "UNPROCESSABLE_ENTITY",
      body: { code: "FAILED_TO_CREATE_USER" },
    });
    expect(postgresErrorCode(error)).toBeUndefined();
  });

  it("logs the refused insert without the address", async () => {
    const { db } = losingRaceDatabase();
    const auth = createAuth({
      db,
      emailSender: createRecordingEmailSender(),
      dispatches: createInMemoryVerificationDispatchStore(),
      clock: { now: () => new Date("2026-09-13T12:00:00.000Z") },
      baseUrl: "http://localhost:3000",
      secret: "a".repeat(32),
      from: "3moji <no-reply@mail.3moji.me>",
    });

    await expect(
      auth.api.signUpEmail({
        body: { email: EMAIL, password: PASSWORD, name: "Someone" },
      }),
    ).rejects.toMatchObject({ body: { code: "FAILED_TO_CREATE_USER" } });

    // Better Auth logs the error it caught before replacing it. That line
    // exists, and it names neither the address nor Postgres's `detail`.
    const output = printed.join("\n");
    expect(output).toContain("Failed to create user");
    expect(output).not.toContain(EMAIL);
    expect(output).toContain("23505");
  });
});
