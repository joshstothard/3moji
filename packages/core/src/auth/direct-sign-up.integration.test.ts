import path from "node:path";

import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { betterAuth } from "better-auth";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";

import { createInMemoryVerificationDispatchStore } from "../adapters/in-memory-verification-dispatch-store";
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
const BASE_URL = "http://localhost:3000";
const SECRET = "integration-test-secret-of-sufficient-length";
const PASSWORD = "correct horse battery staple";
const SUITE_TAG = `direct-signup-int-${String(Date.now())}`;

/** A fresh address per case, so no test depends on another's cleanup. */
const addressFor = (name: string): string => `${SUITE_TAG}-${name}@example.com`;

/**
 * A direct sign-up, **through the same handler the app's route serves.**
 *
 * `apps/web/src/app/api/auth/[...all]/route.ts` hands every request to
 * `toNextJsHandler(auth)`, and that is `(request) => auth.handler(request)` in
 * better-auth 1.7.4 — so calling `auth.handler` here is the route minus Next.js.
 * The `Origin` header is the app's own, as a browser on the site would send:
 * without it Better Auth's origin check could refuse the request first, and the
 * measurement would report "already blocked" for a reason that has nothing to
 * do with sign-up.
 */
const signUpRequest = (pathname: string, body: unknown): Request =>
  new Request(`${BASE_URL}${pathname}`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: BASE_URL },
    body: JSON.stringify(body),
  });

describeWithDatabase("sign-up that bypasses the Claim (#150)", () => {
  let pool: Pool;
  let db: ReturnType<typeof drizzle<typeof authSchema>>;
  let emailSender: ReturnType<typeof createRecordingEmailSender>;
  let auth: ReturnType<typeof createAuth>;

  beforeAll(async () => {
    pool = new Pool({ connectionString: url });
    db = drizzle(pool, { schema: authSchema });
    await migrate(db, { migrationsFolder: MIGRATIONS });

    emailSender = createRecordingEmailSender();
    auth = createAuth({
      db,
      emailSender,
      dispatches: createInMemoryVerificationDispatchStore(),
      clock: { now: () => new Date() },
      baseUrl: BASE_URL,
      secret: SECRET,
      from: "3moji <no-reply@mail.3moji.me>",
    });
  });

  afterAll(async () => {
    // Removes only this run's rows; sessions, accounts and handles cascade.
    await db.execute(
      sql`DELETE FROM "user" WHERE email LIKE ${`${SUITE_TAG}%`}`,
    );
    await pool.end();
  });

  beforeEach(() => {
    emailSender.clear();
  });

  /**
   * What a request left behind, as one value.
   *
   * Asserted whole, so a red run prints every field at once — the status, whether
   * an Account now exists, whether it owns a Handle, and how many emails went
   * out — instead of stopping at the first one that differs.
   */
  const aftermath = async (email: string, response: Response) => {
    const result = await db.execute<{ users: string; handles: string }>(
      sql`SELECT
            (SELECT count(*) FROM "user" WHERE lower(email) = lower(${email})) AS users,
            (SELECT count(*) FROM "handle" h JOIN "user" u ON u.id = h.user_id
              WHERE lower(u.email) = lower(${email})) AS handles`,
    );
    const row = (result.rows as { users: string; handles: string }[])[0];
    return {
      status: response.status,
      accountsCreated: Number(row?.users ?? "-1"),
      handlesOwned: Number(row?.handles ?? "-1"),
      emailsSent: emailSender.sent.filter(
        (sent) => sent.to.toLowerCase() === email.toLowerCase(),
      ).length,
    };
  };

  describe("POST /api/auth/sign-up/email", () => {
    it("is refused for a fresh address, creating no Account and sending no email", async () => {
      const email = addressFor("fresh");

      const response = await auth.handler(
        signUpRequest("/api/auth/sign-up/email", {
          email,
          password: PASSWORD,
          name: "Direct Sign-up",
        }),
      );

      // Measured on main before the fix: { status: 200, accountsCreated: 1,
      // handlesOwned: 0, emailsSent: 1 } — a Handle-less Account (ADR-0004
      // decision 4) and a verification email, from an unlimited endpoint.
      expect(await aftermath(email, response)).toEqual({
        status: 404,
        accountsCreated: 0,
        handlesOwned: 0,
        emailsSent: 0,
      });
    });

    it("answers a registered and an unregistered address identically", async () => {
      const registered = addressFor("registered");
      await auth.api.signUpEmail({
        body: { email: registered, password: PASSWORD, name: "Registered" },
      });
      emailSender.clear();
      const unregistered = addressFor("unregistered");

      const send = (email: string) =>
        auth.handler(
          signUpRequest("/api/auth/sign-up/email", {
            email,
            password: PASSWORD,
            name: "Direct Sign-up",
          }),
        );
      const forRegistered = await send(registered);
      const forUnregistered = await send(unregistered);
      // A request with no address at all: if it gets the same answer, the
      // refusal cannot have read the address, so neither the body nor the time
      // it takes can depend on one.
      const withNoAddress = await auth.handler(
        signUpRequest("/api/auth/sign-up/email", {}),
      );

      const shape = async (response: Response) => ({
        status: response.status,
        body: await response.text(),
      });
      const registeredShape = await shape(forRegistered);
      expect(await shape(forUnregistered)).toEqual(registeredShape);
      expect(await shape(withNoAddress)).toEqual(registeredShape);
      expect(registeredShape.status).toBe(404);

      expect(emailSender.sent).toHaveLength(0);
      const accounts = await db.execute<{ count: string }>(
        sql`SELECT count(*) AS count FROM "user" WHERE email IN (${registered}, ${unregistered})`,
      );
      expect((accounts.rows as { count: string }[])[0]?.count).toBe("1");
    });

    it.each([
      ["a trailing slash", "/api/auth/sign-up/email/"],
      ["a query string", "/api/auth/sign-up/email?x=1"],
      ["a doubled slash", "/api/auth//sign-up/email"],
      ["different case", "/api/auth/Sign-Up/Email"],
      ["a percent-encoded letter", "/api/auth/sign-up/%65mail"],
    ])(
      "cannot be reached by spelling the path with %s",
      async (name, pathname) => {
        const email = addressFor(`spelling-${name.replace(/\W+/g, "-")}`);

        const response = await auth.handler(
          signUpRequest(pathname, {
            email,
            password: PASSWORD,
            name: "Direct Sign-up",
          }),
        );

        const result = await aftermath(email, response);
        expect({
          accountsCreated: result.accountsCreated,
          emailsSent: result.emailsSent,
        }).toEqual({ accountsCreated: 0, emailsSent: 0 });
        expect(result.status).toBeGreaterThanOrEqual(400);
      },
    );
  });

  describe("the other HTTP endpoints that can create an Account", () => {
    // In better-auth 1.7.4 `internalAdapter.createUser` has exactly two callers:
    // the email sign-up above, and `handleOAuthUserInfo`, reached from
    // `/sign-in/social` (with an id token) and `/callback/:id`.
    it("refuses /sign-in/social the same way, creating no Account", async () => {
      const email = addressFor("social");

      const response = await auth.handler(
        signUpRequest("/api/auth/sign-in/social", {
          provider: "google",
          idToken: { token: "not-a-real-token" },
        }),
      );
      const body = await response.clone().text();
      const signUpRefusal = await auth.handler(
        signUpRequest("/api/auth/sign-up/email", {}),
      );

      expect(await aftermath(email, response)).toEqual({
        status: 404,
        accountsCreated: 0,
        handlesOwned: 0,
        emailsSent: 0,
      });
      // With no provider configured it is already a 404, but a *different*
      // one (PROVIDER_NOT_FOUND) that the first configured provider would turn
      // into an Account. The same refusal as sign-up is what says it is closed.
      expect(body).toBe(await signUpRefusal.text());
    });

    it("creates no Account from /callback/:id, because no social provider is configured", async () => {
      const before = await db.execute<{ count: string }>(
        sql`SELECT count(*) AS count FROM "user"`,
      );

      const response = await auth.handler(
        new Request(`${BASE_URL}/api/auth/callback/google?code=x&state=y`, {
          headers: { origin: BASE_URL },
        }),
      );

      const after = await db.execute<{ count: string }>(
        sql`SELECT count(*) AS count FROM "user"`,
      );
      expect(response.status).not.toBe(200);
      expect((after.rows as { count: string }[])[0]?.count).toBe(
        (before.rows as { count: string }[])[0]?.count,
      );
      expect(emailSender.sent).toHaveLength(0);
    });
  });

  describe("the server-side sign-up the Claim depends on", () => {
    it("still creates an Account and sends its verification email", async () => {
      const email = addressFor("server-side");

      await auth.api.signUpEmail({
        body: { email, password: PASSWORD, name: "Claim" },
      });

      const users = await db.execute<{ count: string }>(
        sql`SELECT count(*) AS count FROM "user" WHERE email = ${email}`,
      );
      expect((users.rows as { count: string }[])[0]?.count).toBe("1");
      expect(emailSender.sent.map((sent) => sent.to)).toEqual([email]);
    });

    it("would be refused too by emailAndPassword.disableSignUp, which is why that option is not used", async () => {
      // A measurement of the library, not of our configuration: the alternative
      // the issue weighed. `disableSignUp` is checked inside the endpoint's own
      // body, which `auth.api.signUpEmail` runs as well as the HTTP route — so
      // it would take the Claim down with the bypass.
      const disabled = betterAuth({
        secret: SECRET,
        baseURL: BASE_URL,
        database: drizzleAdapter(db, { provider: "pg", schema: authSchema }),
        emailAndPassword: { enabled: true, disableSignUp: true },
      });
      const email = addressFor("disable-sign-up");

      let code: unknown;
      try {
        await disabled.api.signUpEmail({
          body: { email, password: PASSWORD, name: "Claim" },
        });
      } catch (error) {
        code =
          typeof error === "object" && error !== null && "body" in error
            ? (error.body as { code?: unknown } | undefined)?.code
            : undefined;
      }

      expect(code).toBe("EMAIL_PASSWORD_SIGN_UP_DISABLED");
      const users = await db.execute<{ count: string }>(
        sql`SELECT count(*) AS count FROM "user" WHERE email = ${email}`,
      );
      expect((users.rows as { count: string }[])[0]?.count).toBe("0");
    });
  });
});
