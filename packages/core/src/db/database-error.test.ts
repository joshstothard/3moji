import { DrizzleQueryError } from "drizzle-orm";
import { DatabaseError } from "pg";

import {
  DatabaseQueryFailed,
  toSafeDatabaseError,
  withSafeDatabaseErrors,
} from "./database-error";
import { postgresErrorCode, UNIQUE_VIOLATION } from "./postgres-error";

const EMAIL = "someone@example.com";

/** Built the way drizzle-orm's `pg-core/session.js` builds one. */
function drizzleFailure(cause: unknown): DrizzleQueryError {
  return new DrizzleQueryError(
    'insert into "user" ("email") values ($1)',
    [EMAIL],
    cause instanceof Error ? cause : undefined,
  );
}

function pgError(fields: { code: string; constraint?: string }): DatabaseError {
  const error = new DatabaseError(
    'duplicate key value violates unique constraint "user_email_unique"',
    0,
    "error",
  );
  error.severity = "ERROR";
  error.code = fields.code;
  error.detail = `Key (email)=(${EMAIL}) already exists.`;
  if (fields.constraint !== undefined) error.constraint = fields.constraint;
  return error;
}

describe("toSafeDatabaseError (#144)", () => {
  it("replaces a DrizzleQueryError with one that keeps the SQLSTATE and constraint, and nothing else", () => {
    const safe = toSafeDatabaseError(
      drizzleFailure(
        pgError({ code: UNIQUE_VIOLATION, constraint: "user_email_unique" }),
      ),
    );

    expect(safe).toBeInstanceOf(DatabaseQueryFailed);
    expect(safe).toMatchObject({
      name: "DatabaseQueryFailed",
      code: "23505",
      constraint: "user_email_unique",
      message: "A database query failed with code 23505.",
    });
    expect(postgresErrorCode(safe)).toBe(UNIQUE_VIOLATION);
    expect(JSON.stringify(safe)).not.toContain(EMAIL);
    expect(String(safe)).not.toContain(EMAIL);
    expect(safe).not.toHaveProperty("cause");
  });

  it("replaces a raw pg DatabaseError too, whose detail quotes the value", () => {
    const safe = toSafeDatabaseError(pgError({ code: "23503" }));

    expect(safe).toMatchObject({ code: "23503", constraint: undefined });
    expect(JSON.stringify(safe)).not.toContain(EMAIL);
  });

  it("keeps a connection failure's system code, as postgresErrorCode would read it", () => {
    const refused = Object.assign(new Error("connect ECONNREFUSED 10.0.0.1"), {
      code: "ECONNREFUSED",
    });

    const safe = toSafeDatabaseError(drizzleFailure(refused));

    expect(safe).toMatchObject({
      code: "ECONNREFUSED",
      message: "A database query failed with code ECONNREFUSED.",
    });
  });

  it("never copies a code or constraint that could be free text", () => {
    const hostile = pgError({ code: `bad ${EMAIL}`, constraint: EMAIL });

    const safe = toSafeDatabaseError(drizzleFailure(hostile));

    expect(safe).toMatchObject({ code: "UNRECOGNISED", constraint: undefined });
    expect(JSON.stringify(safe)).not.toContain(EMAIL);
    expect(String(safe)).not.toContain(EMAIL);
  });

  it("says only that a query failed when no code exists", () => {
    const safe = toSafeDatabaseError(drizzleFailure(undefined));

    expect(safe).toMatchObject({
      code: undefined,
      message: "A database query failed.",
    });
  });

  it.each([
    ["a plain Error", new Error("the domain's own failure")],
    [
      "a Better Auth APIError-shaped error",
      Object.assign(new Error("Invalid token"), {
        status: "UNAUTHORIZED",
        body: { code: "INVALID_TOKEN" },
      }),
    ],
    [
      "a refused connection with no statement",
      Object.assign(new Error("connect ECONNREFUSED"), {
        code: "ECONNREFUSED",
      }),
    ],
    ["a thrown string", "not an error"],
    ["null", null],
  ])("passes %s through as the same value", (_what, error) => {
    expect(toSafeDatabaseError(error)).toBe(error);
  });

  it("is idempotent, so a store wrapping an adapter's error changes nothing", () => {
    const once = toSafeDatabaseError(
      drizzleFailure(pgError({ code: UNIQUE_VIOLATION })),
    );

    expect(toSafeDatabaseError(once)).toBe(once);
  });

  it("stops at a cause loop rather than walking forever", () => {
    const looped: { cause?: unknown; query: string; params: unknown[] } = {
      query: "select 1",
      params: [EMAIL],
    };
    looped.cause = looped;

    expect(toSafeDatabaseError(looped)).toMatchObject({ code: undefined });
  });
});

describe("withSafeDatabaseErrors (#144)", () => {
  it("resolves with the operation's value", async () => {
    await expect(
      withSafeDatabaseErrors(() => Promise.resolve(42)),
    ).resolves.toBe(42);
  });

  it("rejects with the safe error in place of a database one", async () => {
    const failure = await withSafeDatabaseErrors(() =>
      Promise.reject(drizzleFailure(pgError({ code: UNIQUE_VIOLATION }))),
    ).catch((error: unknown) => error);

    expect(failure).toMatchObject({
      name: "DatabaseQueryFailed",
      code: "23505",
    });
  });
});
