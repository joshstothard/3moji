/**
 * @jest-environment node
 */

/**
 * The one way a failure on a personal-data path reaches the logs (#134).
 *
 * **The message of a thrown error is free text written by somebody else** —
 * Better Auth, the `pg` driver through Drizzle, the Resend API — and it can
 * quote the values involved. A Postgres unique violation reads
 * `Key (email)=(someone@example.com) already exists`. So nothing here may ever
 * copy a message, a thrown string or any other free text into a log line: what
 * is logged is either an identifier-shaped value that passed an allow-list, or
 * a literal chosen from a fixed set.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describeError, logFailure, REQUIRED_VARIABLES } from "./log-error";

const EMAIL = "someone@example.com";
const PASSWORD = "hunter2-Tr0ub4dor&3";

/** Everything the helper wrote to the console, as one string to search. */
function captured(run: () => void): string {
  const spy = jest.spyOn(console, "error").mockImplementation(() => undefined);
  try {
    run();
    return JSON.stringify(spy.mock.calls);
  } finally {
    spy.mockRestore();
  }
}

/** What the Drizzle driver rejects with: no code of its own, the driver's error in `cause`. */
function drizzleUniqueViolation(): Error {
  const driver = Object.assign(
    new Error(
      `duplicate key value violates unique constraint "user_email_unique"`,
    ),
    {
      name: "DatabaseError",
      code: "23505",
      detail: `Key (email)=(${EMAIL}) already exists.`,
    },
  );
  const query = new Error(
    `Failed query: insert into "user" values ($1, $2) params: ${EMAIL},${PASSWORD}`,
    { cause: driver },
  );
  query.name = "DrizzleQueryError";
  return query;
}

describe("logFailure", () => {
  it.each([
    [
      "an email address",
      new Error(`Key (email)=(${EMAIL}) already exists.`),
      EMAIL,
    ],
    [
      "a password",
      new Error(`password authentication failed: "${PASSWORD}"`),
      PASSWORD,
    ],
    ["an email address in the cause chain", drizzleUniqueViolation(), EMAIL],
    ["a password in the cause chain", drizzleUniqueViolation(), PASSWORD],
    ["a thrown string", `could not send to ${EMAIL}`, EMAIL],
  ])("never writes %s into the log line", (_what, error, secret) => {
    const output = captured(() => {
      logFailure("claim_submit_failed", error);
    });

    expect(output).toContain("claim_submit_failed");
    expect(output).not.toContain(secret);
  });

  it("writes one JSON line whose event stays a top-level field", () => {
    const spy = jest
      .spyOn(console, "error")
      .mockImplementation(() => undefined);

    logFailure("profile_read_failed", drizzleUniqueViolation());

    expect(spy).toHaveBeenCalledTimes(1);
    const line: unknown = spy.mock.calls[0]?.[0];
    expect(JSON.parse(typeof line === "string" ? line : "null")).toEqual({
      event: "profile_read_failed",
      error: {
        name: "DrizzleQueryError",
        code: "23505",
        causes: ["DatabaseError"],
      },
    });
    spy.mockRestore();
  });
});

describe("describeError", () => {
  it("keeps the name of a plain Error and nothing from its message", () => {
    expect(describeError(new Error(`bad address ${EMAIL}`))).toEqual({
      name: "Error",
    });
  });

  it("reaches the SQLSTATE through Drizzle's cause, which has none of its own", () => {
    expect(describeError(drizzleUniqueViolation())).toMatchObject({
      code: "23505",
    });
  });

  it("keeps a Node system error's code, which is what a refused connection is", () => {
    const refused = Object.assign(
      new Error("connect ECONNREFUSED 10.0.0.1:5432"),
      {
        code: "ECONNREFUSED",
      },
    );

    expect(describeError(refused)).toEqual({
      name: "Error",
      code: "ECONNREFUSED",
    });
  });

  it("keeps Better Auth's status and code from an APIError", () => {
    const apiError = Object.assign(new Error(`User ${EMAIL} is not verified`), {
      name: "APIError",
      status: "FORBIDDEN",
      body: {
        code: "EMAIL_NOT_VERIFIED",
        message: `User ${EMAIL} is not verified`,
      },
    });

    expect(describeError(apiError)).toEqual({
      name: "APIError",
      status: "FORBIDDEN",
      code: "EMAIL_NOT_VERIFIED",
    });
  });

  it("names the missing environment variable, which the message is otherwise the only record of", () => {
    const unset = new Error(
      "DATABASE_URL is not set. It is required to serve authenticated requests; see apps/web/.env.example.",
    );

    expect(describeError(unset)).toEqual({
      name: "Error",
      missing: "DATABASE_URL",
    });
  });

  it("keeps the three-digit status from a message that states only that, and none of its other words", () => {
    const rejected = new Error(
      `Some provider rejected the request with status 422. The \`to\` field ${EMAIL} is invalid.`,
    );

    const described = describeError(rejected);

    expect(described).toEqual({ name: "Error", status: "422" });
    expect(JSON.stringify(described)).not.toContain(EMAIL);
  });

  it("reads the Resend adapter's rejection from its status and code properties (#140)", () => {
    // The shape of core's `ResendRequestRejected`, built here because every
    // web suite mocks `@template/core`. The message deliberately names no
    // status, so only the properties can supply one.
    const rejected = Object.assign(
      new Error("Resend rejected the request (VALIDATION_ERROR)."),
      { name: "ResendRequestRejected", status: 422, code: "VALIDATION_ERROR" },
    );

    expect(describeError(rejected)).toEqual({
      name: "ResendRequestRejected",
      code: "VALIDATION_ERROR",
      status: "422",
    });
  });

  it("refuses a name or a code that is not identifier-shaped", () => {
    const hostile = Object.assign(new Error("x"), {
      name: `Error for ${EMAIL}`,
      code: `Key (email)=(${EMAIL})`,
    });

    const described = describeError(hostile);

    expect(described).toEqual({ name: "UnrecognisedError" });
  });

  it("describes a thrown value that is not an object without repeating it", () => {
    expect(describeError(`could not send to ${EMAIL}`)).toEqual({
      name: "NonErrorThrown",
    });
    expect(describeError(undefined)).toEqual({ name: "NonErrorThrown" });
  });

  it("stops on a cause chain that loops rather than hanging", () => {
    const looped = new Error("loop");
    Object.assign(looped, { cause: looped });

    expect(describeError(looped)).toEqual({ name: "Error" });
  });

  it("never throws itself, because it only ever runs inside a catch", () => {
    const hostile = new Proxy(
      {},
      {
        get: () => {
          throw new Error(EMAIL);
        },
        has: () => true,
      },
    );

    expect(() => describeError(hostile)).not.toThrow();
    expect(JSON.stringify(describeError(hostile))).not.toContain(EMAIL);
  });

  it("recognises every variable the services require, so none goes back to an anonymous Error", () => {
    // Read as text rather than imported: `services.ts` is mocked in every suite
    // that logs, and importing it here would build the real services.
    const source = readFileSync(resolve(__dirname, "services.ts"), "utf8");
    const required = [...source.matchAll(/required\("([A-Z0-9_]+)"\)/g)].map(
      (match) => match[1],
    );

    expect(required.length).toBeGreaterThan(0);
    expect([...REQUIRED_VARIABLES].sort()).toEqual(
      [...new Set(required)].sort(),
    );
  });
});
