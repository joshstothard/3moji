import path from "node:path";

import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";

import { createDrizzleAccountDirectory } from "../adapters/drizzle-account-directory";
import { createDrizzleClaimFinaliser } from "../adapters/drizzle-claim-finaliser";
import { createDrizzleClaimStore } from "../adapters/drizzle-claim-store";
import { createDrizzleVerificationDispatchStore } from "../adapters/drizzle-verification-dispatch-store";
import {
  HANDLE_KEY_LENGTH,
  toHandleKey,
  type HandleKey,
} from "../db/handle-key";
import { authSchema } from "../db/schema";
import { releasedEmojiSet } from "../emoji/emoji-set";
import { claimHandle } from "../handle/claim-handle";
import type { Clock } from "../ports/clock";
import { createRecordingEmailSender } from "./adapters/recording-email-sender";
import type { AuthFactory } from "./auth-factory";
import { createAuth } from "./create-auth";
import { createBetterAuthVerificationMailer } from "./adapters/better-auth-verification-mailer";
import { finaliseClaim } from "./finalise-claim";
import { resendVerification } from "./resend-verification";

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
const BASE_URL = "http://localhost:3000";

/** Every Account this suite creates carries this tag, and only these are deleted. */
const SUITE_TAG = `verify-int-${String(Date.now())}`;
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
 * The token out of a verification link.
 *
 * Better Auth's two link shapes differ and only a real run reveals it:
 * verification puts the token in a **query parameter**, password reset in a
 * **path segment**. Both are handled here, because a helper that handles only
 * the query form passes every verification test and fails every reset test
 * (`quality-strategy.md`).
 */
const tokenFrom = (text: string | undefined): string => {
  const body = text ?? "";

  const query = /[?&]token=([^&\s]+)/.exec(body);
  if (query?.[1] !== undefined) return decodeURIComponent(query[1]);

  const segment = /\/reset-password\/([^/?\s]+)/.exec(body);
  if (segment?.[1] !== undefined) return segment[1];

  throw new Error(`No token found in email body: ${body}`);
};

/**
 * Verification, resend and finalisation against a real Postgres and the real
 * Better Auth.
 *
 * **This is where the two claims of #82 that a fake cannot make are made.**
 *
 * - *Each resend invalidates the previous link.* Better Auth's verification
 *   token is a signed JWT it never stores, so both links really are valid as
 *   far as the library is concerned — the older one is refused only because our
 *   own record says a newer one exists. A fake mailer could not produce two
 *   genuinely valid JWTs to tell apart.
 * - *Verifying finalises the Claim.* `handle.claimed_at` filling in, in the
 *   same transaction as `user.email_verified`, is a fact about two tables.
 *
 * **These tests never drop a schema or a table** — a misaimed `DATABASE_URL`
 * would become data loss. Every Account carries `SUITE_TAG` in its email and
 * only those are deleted; Handles and dispatch rows go with them through the
 * cascades their foreign keys already declare.
 */
describeWithDatabase("verification against a real Postgres", () => {
  let pool: Pool;
  let db: ReturnType<typeof drizzle<typeof authSchema>>;
  let emailSender: ReturnType<typeof createRecordingEmailSender>;
  let dispatches: ReturnType<typeof createDrizzleVerificationDispatchStore>;
  let directory: ReturnType<typeof createDrizzleAccountDirectory>;
  let store: ReturnType<typeof createDrizzleClaimStore>;
  let finaliser: ReturnType<typeof createDrizzleClaimFinaliser>;
  let mailer: ReturnType<typeof createBetterAuthVerificationMailer>;

  /** Moved by hand, so the rate-limit window and the hold are testable. */
  let now = new Date("2026-09-12T12:00:00.000Z");
  const clock: Clock = { now: () => now };

  const removeOwnRows = async (): Promise<void> => {
    await db.execute(
      sql`DELETE FROM "user" WHERE email LIKE ${`${SUITE_TAG}%`}`,
    );
  };

  const userRow = async (email: string) => {
    const result = await db.execute<{
      id: string;
      email_verified: boolean;
    }>(sql`SELECT id, email_verified FROM "user" WHERE email = ${email}`);
    return (result.rows as { id: string; email_verified: boolean }[])[0];
  };

  const holdRow = async (key: string) => {
    const result = await db.execute<{
      held_until: Date;
      claimed_at: Date | null;
    }>(sql`SELECT held_until, claimed_at FROM "handle" WHERE key = ${key}`);
    return (result.rows as { held_until: Date; claimed_at: Date | null }[])[0];
  };

  const dispatchCount = async (userId: string): Promise<number> => {
    const result = await db.execute<{ count: string }>(
      sql`SELECT count(*) AS count FROM "verification_dispatch" WHERE user_id = ${userId}`,
    );
    return Number((result.rows as { count: string }[])[0]?.count ?? "-1");
  };

  beforeAll(async () => {
    pool = new Pool({
      connectionString: url,
      options: "-c statement_timeout=10000",
    });
    db = drizzle(pool, { schema: authSchema });
    // Idempotent, so it does not matter whether another suite migrated first.
    await migrate(db, { migrationsFolder: MIGRATIONS });
    await removeOwnRows();

    emailSender = createRecordingEmailSender();
    dispatches = createDrizzleVerificationDispatchStore({ db });
    directory = createDrizzleAccountDirectory(db);

    const auth: AuthFactory = ({
      db: client,
      emailSender: sender,
      dispatches: store_,
    }) =>
      createAuth({
        db: client,
        emailSender: sender,
        dispatches: store_,
        clock,
        baseUrl: BASE_URL,
        secret: "integration-test-secret-of-sufficient-length",
        from: "3moji <no-reply@mail.3moji.me>",
      });

    store = createDrizzleClaimStore({ db, auth, emailSender });
    finaliser = createDrizzleClaimFinaliser({ db, auth, emailSender });
    mailer = createBetterAuthVerificationMailer(
      auth({ db, emailSender, dispatches }),
    );
  });

  afterAll(async () => {
    await removeOwnRows();
    await pool.end();
  });

  beforeEach(() => {
    emailSender.clear();
    now = new Date("2026-09-12T12:00:00.000Z");
  });

  /** Claims a Handle and returns the link the claimant was sent. */
  const claim = async (name: string, offset: number) => {
    const email = addressFor(name);
    const key = handleKeyFromSet(offset);
    const result = await claimHandle({
      segment: key,
      email,
      password: PASSWORD,
      store,
      clock,
    });
    if (result.state !== "held") {
      throw new Error(`the setup Claim did not hold: ${result.state}`);
    }
    const token = tokenFrom(emailSender.lastSent()?.text);
    return { email, key, token };
  };

  it("records a dispatch for the link sign-up sent", async () => {
    const { email, token } = await claim("dispatch", 0);

    const user = await userRow(email);
    expect(await dispatchCount(user?.id ?? "")).toBe(1);
    // The row identifies the link without holding it.
    expect(await dispatches.findByTokenHash("nope")).toBeUndefined();
    expect(token.length).toBeGreaterThan(20);
  });

  it("sends a link to our own verification page, with the token in a query parameter", async () => {
    await claim("link-shape", 3);

    const text = emailSender.lastSent()?.text ?? "";
    expect(text).toContain(`${BASE_URL}/claim/verify?token=`);
    // Better Auth's own endpoint is deliberately not the target: invalidation
    // needs somewhere to run before verification happens.
    expect(text).not.toContain("/api/auth/verify-email");
  });

  it("puts no token in the subject line", async () => {
    const { token } = await claim("subject", 6);
    expect(emailSender.lastSent()?.subject).not.toContain(token);
  });

  it("finalises the Claim and signs them in when the link is followed", async () => {
    const { email, key } = await claim("finalise", 9);
    const token = tokenFrom(emailSender.lastSent()?.text);

    const result = await finaliseClaim({
      token,
      dispatches,
      directory,
      finaliser,
      clock,
    });

    expect(result.state).toBe("claimed");
    if (result.state !== "claimed") throw new Error("expected claimed");
    expect(result.key).toBe(key);
    // autoSignInAfterVerification: the cookies are the sign-in.
    expect(result.headers.get("set-cookie")).toMatch(/session/i);

    expect((await userRow(email))?.email_verified).toBe(true);
    // The half that is easy to forget: without `claimed_at`, the Handle still
    // reads as held and lazy expiry would free it from under its owner.
    expect((await holdRow(key))?.claimed_at).not.toBeNull();
  });

  it("treats a second click of the same link as already claimed", async () => {
    const { key } = await claim("second-click", 12);
    const token = tokenFrom(emailSender.lastSent()?.text);

    await finaliseClaim({ token, dispatches, directory, finaliser, clock });
    const again = await finaliseClaim({
      token,
      dispatches,
      directory,
      finaliser,
      clock,
    });

    expect(again).toEqual({ state: "already-claimed", key });
  });

  it("invalidates the previous link on resend, proved by following the older one", async () => {
    const { email, key } = await claim("resend-invalidates", 15);
    const firstToken = tokenFrom(emailSender.lastSent()?.text);
    emailSender.clear();

    // A minute later, so the one-a-minute floor allows it and the new JWT's
    // `iat` differs from the old one's.
    now = new Date(now.getTime() + 61 * 1000);
    const outcome = await resendVerification({
      email,
      directory,
      dispatches,
      mailer,
      clock,
    });
    expect(outcome).toEqual({ state: "sent" });

    const secondToken = tokenFrom(emailSender.lastSent()?.text);
    expect(secondToken).not.toBe(firstToken);

    // The older link is refused, and the answer still names the Handle so the
    // page can say it is still theirs.
    expect(
      await finaliseClaim({
        token: firstToken,
        dispatches,
        directory,
        finaliser,
        clock,
      }),
    ).toEqual({ state: "link-superseded", key });

    // Nothing was verified by that attempt.
    expect((await userRow(email))?.email_verified).toBe(false);

    // The newest link still works.
    expect(
      (
        await finaliseClaim({
          token: secondToken,
          dispatches,
          directory,
          finaliser,
          clock,
        })
      ).state,
    ).toBe("claimed");
  });

  it("refuses a fourth link inside the hour and a second inside the minute", async () => {
    const { email } = await claim("rate-limit", 18);
    const user = await userRow(email);
    const userId = user?.id ?? "";

    // Sign-up issued the first link, so two more reach the ceiling.
    const attempt = async () =>
      resendVerification({ email, directory, dispatches, mailer, clock });

    now = new Date(now.getTime() + 61 * 1000);
    expect((await attempt()).state).toBe("sent");

    // Immediately again: the one-a-minute floor.
    const tooSoon = await attempt();
    expect(tooSoon.state).toBe("too-soon");

    now = new Date(now.getTime() + 61 * 1000);
    expect((await attempt()).state).toBe("sent");

    // Three links now, all inside the hour.
    now = new Date(now.getTime() + 61 * 1000);
    const tooMany = await attempt();
    expect(tooMany.state).toBe("too-many");

    // Three rows, so the refusals really did send nothing.
    expect(await dispatchCount(userId)).toBe(3);

    // Once the oldest ages out of the window, a link is allowed again.
    now = new Date(now.getTime() + 60 * 60 * 1000);
    expect((await attempt()).state).toBe("sent");
  });

  it("refuses sign-in before verification, which the hold screen renders", async () => {
    const { email } = await claim("signin-403", 21);
    const auth = createAuth({
      db,
      emailSender,
      dispatches,
      clock,
      baseUrl: BASE_URL,
      secret: "integration-test-secret-of-sufficient-length",
      from: "3moji <no-reply@mail.3moji.me>",
    });

    const thrown: unknown = await auth.api
      .signInEmail({ body: { email, password: PASSWORD } })
      .then(() => undefined)
      .catch((error: unknown) => error);

    // 403 FORBIDDEN / EMAIL_NOT_VERIFIED. The transport renders this as the
    // hold screen with a resend action, never as an error.
    const status =
      typeof thrown === "object" && thrown !== null && "status" in thrown
        ? thrown.status
        : undefined;
    expect(status).toBe("FORBIDDEN");
  });

  it("says nothing about an address that has no Account", async () => {
    const outcome = await resendVerification({
      email: addressFor("nobody-here"),
      directory,
      dispatches,
      mailer,
      clock,
    });

    expect(outcome).toEqual({ state: "sent" });
    expect(emailSender.sent).toHaveLength(0);
  });
});
