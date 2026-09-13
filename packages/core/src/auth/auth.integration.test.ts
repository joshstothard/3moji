import path from "node:path";

import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";

import { createInMemoryVerificationDispatchStore } from "../adapters/in-memory-verification-dispatch-store";
import { createRecordingEmailSender } from "./adapters/recording-email-sender";
import { createBetterAuthPasswordResetter } from "./adapters/better-auth-password-resetter";
import { createAuth } from "./create-auth";
import { PASSWORD_MIN_LENGTH } from "./password-length";
import { setNewPassword } from "./password-reset";
import { authSchema } from "../db/schema";

const url = process.env.DATABASE_URL;

if (url === undefined && process.env.CI !== undefined) {
  throw new Error(
    "DATABASE_URL is not set. CI's integration-tests job must provide a Postgres service.",
  );
}

const describeWithDatabase = url === undefined ? describe.skip : describe;
const MIGRATIONS = path.join(__dirname, "..", "..", "migrations");
const PASSWORD = "correct horse battery staple";
const SUITE_TAG = `auth-int-${String(Date.now())}`;

/** A fresh address per case, so no test depends on another's cleanup. */
const addressFor = (name: string): string => `${SUITE_TAG}-${name}@example.com`;

/**
 * Extracts the token from a Better Auth link.
 *
 * The two link shapes differ, which a real run is the only way to discover:
 *
 * - verification: `/api/auth/verify-email?token=<TOKEN>&callbackURL=...`
 * - reset:        `/reset-password/<TOKEN>` — our own page since #192, which
 *                 rewrites Better Auth's `/api/auth/reset-password/<TOKEN>?…`
 *
 * The reset token is a **path segment**, not a query parameter. Handling only
 * the query form silently breaks every reset test.
 */
const tokenFrom = (text: string | undefined): string => {
  const body = text ?? "";

  const query = /[?&]token=([^&\s]+)/.exec(body);
  if (query?.[1] !== undefined) return query[1];

  const segment = /\/reset-password\/([^/?\s]+)/.exec(body);
  if (segment?.[1] !== undefined) return segment[1];

  throw new Error(`No token found in email body: ${body}`);
};

describeWithDatabase("auth against a real Postgres", () => {
  let pool: Pool;
  let db: ReturnType<typeof drizzle<typeof authSchema>>;
  let emailSender: ReturnType<typeof createRecordingEmailSender>;
  let auth: ReturnType<typeof createAuth>;
  let dispatches: ReturnType<typeof createInMemoryVerificationDispatchStore>;

  beforeAll(async () => {
    // Built directly rather than through createDatabase: the migrator needs the
    // concrete node-postgres type, not the union the factory returns.
    pool = new Pool({ connectionString: url });
    db = drizzle(pool, { schema: authSchema });
    await migrate(db, { migrationsFolder: MIGRATIONS });

    emailSender = createRecordingEmailSender();
    dispatches = createInMemoryVerificationDispatchStore();
    auth = createAuth({
      db,
      emailSender,
      dispatches,
      clock: { now: () => new Date() },
      baseUrl: "http://localhost:3000",
      secret: "integration-test-secret-of-sufficient-length",
      from: "3moji <no-reply@mail.3moji.me>",
    });
  });

  afterAll(async () => {
    // Removes only this run's rows; sessions and accounts cascade.
    await db.execute(
      sql`DELETE FROM "user" WHERE email LIKE ${`${SUITE_TAG}%`}`,
    );
    await pool.end();
  });

  beforeEach(() => {
    emailSender.clear();
  });

  const signUp = async (email: string) =>
    auth.api.signUpEmail({
      body: { email, password: PASSWORD, name: "Integration Test" },
    });

  const userRow = async (email: string) => {
    const result = await db.execute<{
      id: string;
      email_verified: boolean;
    }>(sql`SELECT id, email_verified FROM "user" WHERE email = ${email}`);
    return (result.rows as { id: string; email_verified: boolean }[])[0];
  };

  const sessionCount = async (userId: string): Promise<number> => {
    const result = await db.execute<{ count: string }>(
      sql`SELECT count(*) AS count FROM "session" WHERE user_id = ${userId}`,
    );
    return Number((result.rows as { count: string }[])[0]?.count ?? "-1");
  };

  it("creates an unverified user on sign-up and sends one verification email", async () => {
    const email = addressFor("signup");
    await signUp(email);

    const user = await userRow(email);
    expect(user).toBeDefined();
    expect(user?.email_verified).toBe(false);

    expect(emailSender.sent).toHaveLength(1);
    expect(emailSender.lastSent()?.to).toBe(email);
  });

  it("issues no session on sign-up, because verification is required", async () => {
    const email = addressFor("nosession");
    await signUp(email);

    const user = await userRow(email);
    expect(user).toBeDefined();
    expect(await sessionCount(user?.id ?? "")).toBe(0);
  });

  it("refuses sign-in before the email is verified", async () => {
    const email = addressFor("unverified-signin");
    await signUp(email);

    await expect(
      auth.api.signInEmail({ body: { email, password: PASSWORD } }),
    ).rejects.toBeDefined();

    const user = await userRow(email);
    expect(await sessionCount(user?.id ?? "")).toBe(0);
  });

  it("marks the email verified when the link is followed", async () => {
    const email = addressFor("verify");
    await signUp(email);
    const token = tokenFrom(emailSender.lastSent()?.text);

    await auth.api.verifyEmail({ query: { token } });

    expect((await userRow(email))?.email_verified).toBe(true);
  });

  it("allows sign-in once verified", async () => {
    const email = addressFor("verified-signin");
    await signUp(email);
    await auth.api.verifyEmail({
      query: { token: tokenFrom(emailSender.lastSent()?.text) },
    });

    await expect(
      auth.api.signInEmail({ body: { email, password: PASSWORD } }),
    ).resolves.toBeDefined();
  });

  it("does not reveal whether an address is already registered", async () => {
    const email = addressFor("duplicate");
    await signUp(email);
    emailSender.clear();

    // A synthetic success: the caller cannot distinguish this from a new signup.
    await expect(signUp(email)).resolves.toBeDefined();

    const result = await db.execute<{ count: string }>(
      sql`SELECT count(*) AS count FROM "user" WHERE email = ${email}`,
    );
    expect((result.rows as { count: string }[])[0]?.count).toBe("1");
  });

  it("accepts a reset request for an address that does not exist", async () => {
    // Indistinguishable from a real one, so the endpoint cannot enumerate users.
    await expect(
      auth.api.requestPasswordReset({
        body: {
          email: addressFor("nobody-here"),
          redirectTo: "http://localhost:3000",
        },
      }),
    ).resolves.toBeDefined();

    expect(emailSender.sent).toHaveLength(0);
  });

  it("revokes every session when the password is reset", async () => {
    const email = addressFor("reset-revokes");
    await signUp(email);
    await auth.api.verifyEmail({
      query: { token: tokenFrom(emailSender.lastSent()?.text) },
    });
    await auth.api.signInEmail({ body: { email, password: PASSWORD } });

    const user = await userRow(email);
    expect(await sessionCount(user?.id ?? "")).toBeGreaterThan(0);

    emailSender.clear();
    await auth.api.requestPasswordReset({
      body: { email, redirectTo: "http://localhost:3000" },
    });
    await auth.api.resetPassword({
      body: {
        token: tokenFrom(emailSender.lastSent()?.text),
        newPassword: "an entirely different passphrase",
      },
    });

    expect(await sessionCount(user?.id ?? "")).toBe(0);
  });

  it("does not mark the email verified just because a reset succeeded", async () => {
    const email = addressFor("reset-no-verify");
    await signUp(email);
    emailSender.clear();

    await auth.api.requestPasswordReset({
      body: { email, redirectTo: "http://localhost:3000" },
    });
    await auth.api.resetPassword({
      body: {
        token: tokenFrom(emailSender.lastSent()?.text),
        newPassword: "another entirely different passphrase",
      },
    });

    // Clicking a reset link proves control of the address, but the claim gate
    // has exactly one meaning and this is not it (#15).
    expect((await userRow(email))?.email_verified).toBe(false);
  });

  describe("the reset pages' domain, against Better Auth (#192)", () => {
    const resetter = () => createBetterAuthPasswordResetter(auth);
    const NEW_PASSWORD = "a brand new passphrase for #192";

    /** A verified Account, signed in, with the session cookie that proves it. */
    const signedInOwner = async (name: string) => {
      const email = addressFor(name);
      await signUp(email);
      await auth.api.verifyEmail({
        query: { token: tokenFrom(emailSender.lastSent()?.text) },
      });
      const signIn = await auth.api.signInEmail({
        body: { email, password: PASSWORD },
        returnHeaders: true,
      });
      const cookie = signIn.headers
        .getSetCookie()
        .map((line) => line.split(";")[0])
        .join("; ");
      emailSender.clear();
      return { email, cookie };
    };

    const sessionFor = (cookie: string) =>
      auth.api.getSession({ headers: new Headers({ cookie }) });

    const requestLink = async (email: string): Promise<string> => {
      expect(await resetter().request(email)).toBe("accepted");
      return tokenFrom(emailSender.lastSent()?.text);
    };

    it("mails a registered address a link to our own page, the token a path segment, and mails an unregistered one nothing", async () => {
      const { email } = await signedInOwner("reset-link-shape");

      expect(await resetter().request(addressFor("reset-nobody"))).toBe(
        "accepted",
      );
      expect(emailSender.sent).toHaveLength(0);

      expect(await resetter().request(email)).toBe("accepted");
      const text = emailSender.lastSent()?.text ?? "";
      expect(text.match(/https?:\/\/\S+/g)).toEqual([
        `http://localhost:3000/reset-password/${tokenFrom(text)}`,
      ]);
      expect(text).not.toContain("/api/auth/");
      expect(text).not.toContain("token=");
    });

    it("answers an address Better Auth's schema refuses as invalid, before any lookup", async () => {
      expect(await resetter().request("not-an-address")).toBe("invalid");
      expect(emailSender.sent).toHaveLength(0);
    });

    it("sets the new password: the new one signs in and the old one no longer does", async () => {
      const { email } = await signedInOwner("reset-sets");
      const token = await requestLink(email);

      expect(
        await setNewPassword({
          token,
          newPassword: NEW_PASSWORD,
          resetter: resetter(),
        }),
      ).toEqual({ state: "reset" });

      await expect(
        auth.api.signInEmail({ body: { email, password: NEW_PASSWORD } }),
      ).resolves.toBeDefined();
      await expect(
        auth.api.signInEmail({ body: { email, password: PASSWORD } }),
      ).rejects.toBeDefined();
    });

    it("treats a request carrying a pre-reset session cookie as signed out", async () => {
      const { email, cookie } = await signedInOwner("reset-cookie");
      // The cookie really is a live session before the reset.
      expect((await sessionFor(cookie))?.user.email).toBe(email);

      await setNewPassword({
        token: await requestLink(email),
        newPassword: NEW_PASSWORD,
        resetter: resetter(),
      });

      expect(await sessionFor(cookie)).toBeNull();
    });

    it("does not mark the email verified through the reset pages' path either", async () => {
      const email = addressFor("reset-pages-no-verify");
      await signUp(email);
      emailSender.clear();

      await setNewPassword({
        token: await requestLink(email),
        newPassword: NEW_PASSWORD,
        resetter: resetter(),
      });

      expect((await userRow(email))?.email_verified).toBe(false);
    });

    it("answers a used, an unknown and an empty token alike as an invalid link", async () => {
      const { email } = await signedInOwner("reset-invalid");
      const token = await requestLink(email);
      await setNewPassword({
        token,
        newPassword: NEW_PASSWORD,
        resetter: resetter(),
      });

      for (const candidate of [token, "not-a-real-token-at-all", ""]) {
        expect(
          await setNewPassword({
            token: candidate,
            newPassword: NEW_PASSWORD,
            resetter: resetter(),
          }),
        ).toEqual({ state: "invalid-link" });
      }
    });

    it("answers an expired token as an invalid link", async () => {
      const { email } = await signedInOwner("reset-expired");
      const token = await requestLink(email);
      await db.execute(
        sql`UPDATE "verification" SET expires_at = now() - interval '1 minute' WHERE identifier = ${`reset-password:${token}`}`,
      );

      expect(
        await setNewPassword({
          token,
          newPassword: NEW_PASSWORD,
          resetter: resetter(),
        }),
      ).toEqual({ state: "invalid-link" });
    });

    it("refuses a password shorter than PASSWORD_MIN_LENGTH without spending the token", async () => {
      const { email } = await signedInOwner("reset-short");
      const token = await requestLink(email);

      expect(
        await setNewPassword({
          token,
          newPassword: "x".repeat(PASSWORD_MIN_LENGTH - 1),
          resetter: resetter(),
        }),
      ).toEqual({ state: "password-too-short" });
      expect(
        await setNewPassword({
          token,
          newPassword: "x".repeat(PASSWORD_MIN_LENGTH),
          resetter: resetter(),
        }),
      ).toEqual({ state: "reset" });
    });
  });
});
