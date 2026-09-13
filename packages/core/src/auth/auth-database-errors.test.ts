import { createHmac } from "node:crypto";
import { format } from "node:util";

import { createEmailVerificationToken } from "better-auth/api";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import { createInMemoryVerificationDispatchStore } from "../adapters/in-memory-verification-dispatch-store";
import { postgresErrorCode } from "../db/postgres-error";
import { authSchema } from "../db/schema";
import { createBetterAuthVerificationMailer } from "./adapters/better-auth-verification-mailer";
import { createRecordingEmailSender } from "./adapters/recording-email-sender";
import { createAuth } from "./create-auth";

/**
 * **No bound query value leaves Better Auth's own queries**
 * ([#148](https://github.com/joshstothard/3moji/issues/148)).
 *
 * #144 made every database error leaving *our* adapters safe. Sign-in, the
 * session read, verification, password reset and sign-up run through Better
 * Auth's Drizzle adapter instead, so that fix never saw them. What each one
 * does with a failed statement was measured here, not assumed:
 *
 * - sign-in, verification and both reset endpoints have no catch, so the raw
 *   `DrizzleQueryError` — `Failed query: …\nparams: someone@example.com,1` —
 *   is what `auth.api.*` rejects with;
 * - the session read and sign-up do catch, and throw a clean `APIError`, but
 *   hand the raw error to Better Auth's logger first, whose default sink is
 *   `console.error`;
 * - on the HTTP route, better-call's router `console.error`s any error that is
 *   not an `APIError`.
 *
 * So both the thrown value **and** everything written to the console are
 * checked. The errors are real: auth is pointed at a closed port, so
 * drizzle-orm itself wraps the refused connection with the address or token
 * genuinely bound.
 */

const SECRET = "unit-test-secret-of-sufficient-length-148";
const BASE_URL = "http://localhost:3000";
const EMAIL = "someone-148@example.com";
const PASSWORD = "hunter2-Tr0ub4dor&3";
const SESSION_TOKEN = "sessiontoken148sessiontoken148ab";
const RESET_TOKEN = "resettoken148resettoken148resett";
const CLOSED_PORT_URL = "postgresql://app:app@127.0.0.1:59999/app_test";

/** Every rendering a tracker or a log drain could capture, down the chain. */
function everythingSaidBy(error: unknown): string {
  const said: string[] = [format(error)];
  let current: unknown = error;
  for (let depth = 0; depth < 8 && current !== undefined; depth += 1) {
    if (typeof current !== "object" || current === null) {
      said.push(format(current));
      break;
    }
    said.push(Error.prototype.toString.call(current));
    said.push(JSON.stringify(current));
    for (const key of Object.getOwnPropertyNames(current)) {
      said.push(format(Reflect.get(current, key)));
    }
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

/** Better Auth's signed session cookie: `token.base64(HMAC-SHA256)`. */
function signedSessionCookie(token: string): string {
  const signature = createHmac("sha256", SECRET).update(token).digest("base64");
  return `better-auth.session_token=${encodeURIComponent(`${token}.${signature}`)}`;
}

describe("errors from Better Auth's own queries (#148)", () => {
  let pool: Pool;
  let auth: ReturnType<typeof createAuth>;
  let consoleOutput: string[];
  let spies: jest.SpyInstance[];

  beforeAll(() => {
    pool = new Pool({ connectionString: CLOSED_PORT_URL });
    auth = createAuth({
      db: drizzle(pool, { schema: authSchema }),
      emailSender: createRecordingEmailSender(),
      dispatches: createInMemoryVerificationDispatchStore(),
      clock: { now: () => new Date("2026-09-13T12:00:00.000Z") },
      baseUrl: BASE_URL,
      secret: SECRET,
      from: "3moji <no-reply@mail.3moji.me>",
    });
  });

  afterAll(async () => {
    await pool.end();
  });

  beforeEach(() => {
    consoleOutput = [];
    const capture = (...args: unknown[]): void => {
      consoleOutput.push(format(...args));
    };
    spies = [
      jest.spyOn(console, "error").mockImplementation(capture),
      jest.spyOn(console, "warn").mockImplementation(capture),
      jest.spyOn(console, "log").mockImplementation(capture),
    ];
  });

  afterEach(() => {
    for (const spy of spies) spy.mockRestore();
  });

  /** Neither the rejection nor anything printed on the way may name them. */
  function expectNothingBound(error: unknown, secrets: readonly string[]) {
    const said = everythingSaidBy(error);
    const printed = consoleOutput.join("\n");
    for (const secret of secrets) {
      expect(said).not.toContain(secret);
      expect(printed).not.toContain(secret);
    }
  }

  it("sign-in rejects without the address, and keeps the connection code", async () => {
    const error = await rejectionOf(
      auth.api.signInEmail({ body: { email: EMAIL, password: PASSWORD } }),
    );

    expectNothingBound(error, [EMAIL]);
    expect(postgresErrorCode(error)).toBe("ECONNREFUSED");
  });

  it("the session read rejects without the session token", async () => {
    const error = await rejectionOf(
      auth.api.getSession({
        headers: new Headers({ cookie: signedSessionCookie(SESSION_TOKEN) }),
      }),
    );

    expectNothingBound(error, [SESSION_TOKEN]);
    // Better Auth's own verdict, which a caller may read, is left as it was.
    expect(error).toMatchObject({
      body: { code: "FAILED_TO_GET_SESSION" },
    });
  });

  it("sending a verification email rejects without the address", async () => {
    const error = await rejectionOf(
      createBetterAuthVerificationMailer(auth).send(EMAIL),
    );

    expectNothingBound(error, [EMAIL]);
    expect(postgresErrorCode(error)).toBe("ECONNREFUSED");
  });

  it("verification rejects without the address inside the token", async () => {
    const token = await createEmailVerificationToken(SECRET, EMAIL);

    const error = await rejectionOf(auth.api.verifyEmail({ query: { token } }));

    expectNothingBound(error, [EMAIL, token]);
    expect(postgresErrorCode(error)).toBe("ECONNREFUSED");
  });

  it("a password-reset request rejects without the address", async () => {
    const error = await rejectionOf(
      auth.api.requestPasswordReset({
        body: { email: EMAIL, redirectTo: `${BASE_URL}/reset-password` },
      }),
    );

    expectNothingBound(error, [EMAIL]);
    expect(postgresErrorCode(error)).toBe("ECONNREFUSED");
  });

  it("a password reset rejects without the reset token", async () => {
    const error = await rejectionOf(
      auth.api.resetPassword({
        body: { token: RESET_TOKEN, newPassword: PASSWORD },
      }),
    );

    expectNothingBound(error, [RESET_TOKEN]);
    expect(postgresErrorCode(error)).toBe("ECONNREFUSED");
  });

  it("sign-up rejects without the address", async () => {
    const error = await rejectionOf(
      auth.api.signUpEmail({
        body: { email: EMAIL, password: PASSWORD, name: "Someone" },
      }),
    );

    expectNothingBound(error, [EMAIL]);
  });

  it("the HTTP route answers 500 and prints nothing bound", async () => {
    const response = await auth.handler(
      new Request(`${BASE_URL}/api/auth/sign-in/email`, {
        method: "POST",
        headers: { "content-type": "application/json", origin: BASE_URL },
        body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
      }),
    );

    expect(response.status).toBe(500);
    const body = await response.text();
    expect(body).not.toContain(EMAIL);
    expect(consoleOutput.join("\n")).not.toContain(EMAIL);
  });
});
