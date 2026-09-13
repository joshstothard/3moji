import path from "node:path";
import { format } from "node:util";

import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";

import { createInMemoryVerificationDispatchStore } from "../adapters/in-memory-verification-dispatch-store";
import { postgresErrorCode } from "../db/postgres-error";
import { authSchema } from "../db/schema";
import { createRecordingEmailSender } from "./adapters/recording-email-sender";
import { createAuth } from "./create-auth";

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
const SUITE_TAG = `auth-db-error-int-${String(Date.now())}`;
const PASSWORD = "correct horse battery staple";

/** Every rendering a tracker or a log drain could capture, down the chain. */
function everythingSaidBy(error: unknown): string {
  const said: string[] = [format(error)];
  let current: unknown = error;
  for (let depth = 0; depth < 8 && current !== undefined; depth += 1) {
    if (typeof current !== "object" || current === null) break;
    said.push(Error.prototype.toString.call(current));
    said.push(JSON.stringify(current));
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
  throw new Error("expected the call to reject, and it resolved.");
}

/**
 * **Better Auth's own statements, rejected by a real Postgres**
 * ([#148](https://github.com/joshstothard/3moji/issues/148)).
 *
 * The unit suite measures every path against a refused connection. Only a real
 * server proves that a genuine rejection — with a SQLSTATE, and a message
 * Postgres itself wrote — comes out of Better Auth with the code kept and the
 * bound value gone, and that Better Auth's own verdicts still read as before.
 */
describeWithDatabase("errors from Better Auth against a real Postgres", () => {
  let pool: Pool;
  let db: ReturnType<typeof drizzle<typeof authSchema>>;
  let auth: ReturnType<typeof createAuth>;
  let printed: string[];
  let spy: jest.SpyInstance;

  beforeAll(async () => {
    pool = new Pool({ connectionString: url });
    db = drizzle(pool, { schema: authSchema });
    await migrate(db, { migrationsFolder: MIGRATIONS });
    auth = createAuth({
      db,
      emailSender: createRecordingEmailSender(),
      dispatches: createInMemoryVerificationDispatchStore(),
      clock: { now: () => new Date() },
      baseUrl: "http://localhost:3000",
      secret: "integration-test-secret-of-sufficient-length",
      from: "3moji <no-reply@mail.3moji.me>",
    });
  });

  afterAll(async () => {
    await db.execute(
      sql`DELETE FROM "user" WHERE email LIKE ${`${SUITE_TAG}%`}`,
    );
    await pool.end();
  });

  beforeEach(() => {
    printed = [];
    spy = jest.spyOn(console, "error").mockImplementation((...args) => {
      printed.push(format(...args));
    });
  });

  afterEach(() => {
    spy.mockRestore();
  });

  /**
   * A reset token Postgres cannot store: `text` refuses NUL, so the server
   * rejects Better Auth's verification lookup with the token bound.
   */
  it("keeps the SQLSTATE of a rejected reset-token lookup, and not the token", async () => {
    const token = `${SUITE_TAG}-reset\u0000token`;

    const error = await rejectionOf(
      auth.api.resetPassword({ body: { token, newPassword: PASSWORD } }),
    );

    const said = everythingSaidBy(error);
    expect(said).not.toContain(SUITE_TAG);
    expect(printed.join("\n")).not.toContain(SUITE_TAG);
    expect(error).toMatchObject({ name: "DatabaseQueryFailed" });
    // 22021 character_not_in_repertoire: Postgres's own verdict on the NUL,
    // kept, and not a connection code.
    expect(postgresErrorCode(error)).toBe("22021");
  });

  /**
   * `sign-in-action`'s `isUnverified` reads `status` and `body.code`, so the
   * wrapper must leave Better Auth's refusal exactly as it was.
   */
  it("still refuses an unverified sign-in with Better Auth's own 403", async () => {
    const email = `${SUITE_TAG}-unverified@example.com`;
    await auth.api.signUpEmail({
      body: { email, password: PASSWORD, name: "Integration Test" },
    });

    const error = await rejectionOf(
      auth.api.signInEmail({ body: { email, password: PASSWORD } }),
    );

    expect(error).toMatchObject({
      status: "FORBIDDEN",
      body: { code: "EMAIL_NOT_VERIFIED" },
    });
  });

  it("leaves the database answering after the rejection", async () => {
    const result = await db.execute(sql`SELECT 1 AS one`);
    expect(result.rows).toHaveLength(1);
  });
});
