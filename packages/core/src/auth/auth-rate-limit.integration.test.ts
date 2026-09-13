import path from "node:path";

import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";

import { createDrizzleClaimRateLimitStore } from "../adapters/drizzle-claim-rate-limit-store";
import { createInMemoryVerificationDispatchStore } from "../adapters/in-memory-verification-dispatch-store";
import { authSchema } from "../db/schema";
import { createRecordingEmailSender } from "./adapters/recording-email-sender";
import { AUTH_RATE_LIMITS, type AuthRateLimit } from "./auth-rate-limit";
import { createAuth } from "./create-auth";
import {
  RESEND_CLIENT_RATE_LIMIT,
  createResendClientRateLimiter,
  resendClientBucket,
} from "./resend-rate-limit";

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
const SUITE_TAG = `auth-rate-limit-int-${String(Date.now())}`;
/** Generous: several endpoints pad their answer to 500 ms on purpose. */
const SLOW = 90_000;

const addressFor = (name: string): string => `${SUITE_TAG}-${name}@example.com`;

/**
 * A client in its own IPv6 /64 of the documentation prefix, one per test.
 *
 * **Every request names its client explicitly.** Better Auth's rate limiter
 * keys on `ip|path` with no namespace, and in a test environment a request
 * with no readable address falls back to `127.0.0.1` — so a test that forgot
 * the header would share one bucket with every other and pass, or fail, for
 * a reason that has nothing to do with it.
 */
const client = (subnet: number, host = 1): string =>
  `2001:db8:158:${subnet.toString(16)}::${host.toString(16)}`;

/** How Better Auth writes that client into a key: expanded, masked to /64. */
const clientKey = (subnet: number): string =>
  `2001:0db8:0158:${subnet.toString(16).padStart(4, "0")}:0000:0000:0000:0000`;

/** The IPv4 clients this suite uses (TEST-NET-2). */
const V4 = "198.51.100";

/**
 * The one counter every sign-in with no readable address shares **in this
 * test run**. Better Auth's `getIP` answers `127.0.0.1` for such a request
 * when `NODE_ENV` is `test` or `development`, before its rate limiter's
 * production fallback — the shared `no-trusted-ip` key — is ever consulted.
 * No other integration suite sends sign-in over HTTP, so this key is ours.
 */
const UNREADABLE_CLIENT_SIGN_IN_KEY = "127.0.0.1|/sign-in/email";

/**
 * Twenty minutes into an hour far enough in the future that no other run's
 * pruning reaches it; rows are stored under the hour's start.
 */
const RESEND_NOW = new Date("2099-01-01T10:20:00.000Z");
const RESEND_WINDOW_START = new Date("2099-01-01T10:00:00.000Z");

/**
 * **Better Auth's rate limiter against a real Postgres** (#158).
 *
 * Requests go through `auth.handler`, which is what the app's catch-all route
 * serves (`toNextJsHandler(auth)` is `(request) => auth.handler(request)` in
 * better-auth 1.7.4), with the app's own `Origin`.
 *
 * What only this can prove: that each rule binds **at our threshold** on the
 * path as Better Auth routes it — every threshold differs from the built-in
 * rule's 3, so a rule whose path string did not match would be caught — that
 * the counters are rows rather than process memory, and that a refused
 * password-reset request says nothing about the address it named.
 *
 * These tests never drop anything; they delete exactly the keys they wrote.
 */
describeWithDatabase("Better Auth's rate limit against a real Postgres", () => {
  let pool: Pool;
  let db: ReturnType<typeof drizzle<typeof authSchema>>;
  let emailSender: ReturnType<typeof createRecordingEmailSender>;
  let auth: ReturnType<typeof createAuth>;

  const forgetThisSuitesCounters = async (): Promise<void> => {
    await db.execute(sql`
      DELETE FROM auth_rate_limit
      WHERE key LIKE ${"2001:0db8:0158:%"} OR key LIKE ${`${V4}.%`}
         OR key = ${UNREADABLE_CLIENT_SIGN_IN_KEY}
    `);
  };

  beforeAll(async () => {
    pool = new Pool({ connectionString: url });
    db = drizzle(pool, { schema: authSchema });
    await migrate(db, { migrationsFolder: MIGRATIONS });
    await forgetThisSuitesCounters();

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
    await forgetThisSuitesCounters();
    await db.execute(
      sql`DELETE FROM claim_rate_limit WHERE window_start = ${RESEND_WINDOW_START}`,
    );
    await db.execute(
      sql`DELETE FROM "user" WHERE email LIKE ${`${SUITE_TAG}%`}`,
    );
    await pool.end();
  });

  beforeEach(() => {
    emailSender.clear();
  });

  const post = (
    pathname: string,
    body: unknown,
    headers: Readonly<Record<string, string>>,
  ): Promise<Response> =>
    auth.handler(
      new Request(`${BASE_URL}/api/auth${pathname}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: BASE_URL,
          ...headers,
        },
        body: JSON.stringify(body),
      }),
    );

  /** Send `count` requests one after another; answer their statuses. */
  const statusesOf = async (
    count: number,
    send: () => Promise<Response>,
  ): Promise<number[]> => {
    const statuses: number[] = [];
    for (let request = 0; request < count; request += 1) {
      const response = await send();
      await response.arrayBuffer();
      statuses.push(response.status);
    }
    return statuses;
  };

  const storedCount = async (key: string): Promise<number | undefined> => {
    const result = await db.execute<{ count: number }>(
      sql`SELECT count FROM auth_rate_limit WHERE key = ${key}`,
    );
    return (result.rows as { count: number }[])[0]?.count;
  };

  describe.each<{
    readonly pathname: string;
    readonly limit: AuthRateLimit;
    readonly body: (email: string) => unknown;
    readonly subnet: number;
  }>([
    {
      pathname: "/sign-in/email",
      limit: AUTH_RATE_LIMITS.signInEmail,
      body: (email) => ({ email, password: PASSWORD }),
      subnet: 1,
    },
    {
      pathname: "/request-password-reset",
      limit: AUTH_RATE_LIMITS.requestPasswordReset,
      body: (email) => ({ email, redirectTo: BASE_URL }),
      subnet: 2,
    },
    {
      pathname: "/send-verification-email",
      limit: AUTH_RATE_LIMITS.sendVerificationEmail,
      body: (email) => ({ email }),
      subnet: 3,
    },
  ])("POST $pathname", ({ pathname, limit, body, subnet }) => {
    it(
      "admits exactly its maximum from one client, then answers 429, counting in the database",
      async () => {
        const email = addressFor(`rule-${String(subnet)}`);
        const from = { "x-forwarded-for": client(subnet) };

        const admitted = await statusesOf(limit.max, () =>
          post(pathname, body(email), from),
        );
        const refused = await post(pathname, body(email), from);
        // Another /64 has its own counter.
        const neighbour = await post(pathname, body(email), {
          "x-forwarded-for": client(subnet + 100),
        });

        expect({
          admitted: admitted.filter((status) => status !== 429).length,
          refused: refused.status,
          refusedBody: await refused.json(),
          neighbourRefused: neighbour.status === 429,
          // A row, not process memory: on Vercel every instance has its own.
          stored: await storedCount(`${clientKey(subnet)}|${pathname}`),
        }).toEqual({
          admitted: limit.max,
          refused: 429,
          refusedBody: {
            message: "Too many requests. Please try again later.",
          },
          neighbourRefused: false,
          stored: limit.max,
        });
      },
      SLOW,
    );
  });

  describe("POST /sign-up/email", () => {
    it(
      "needs no rule: the #150 refusal answers 404 before the limiter counts anything",
      async () => {
        const from = { "x-forwarded-for": client(20) };

        const statuses = await statusesOf(12, () =>
          post(
            "/sign-up/email",
            { email: addressFor("sign-up"), password: PASSWORD, name: "X" },
            from,
          ),
        );

        expect({
          statuses: [...new Set(statuses)],
          stored: await storedCount(`${clientKey(20)}|/sign-up/email`),
        }).toEqual({ statuses: [404], stored: undefined });
      },
      SLOW,
    );
  });

  describe("spelling the sign-in path differently", () => {
    it.each([
      ["a trailing slash", "/sign-in/email/", 30],
      ["a query string", "/sign-in/email?x=1", 31],
      ["different case", "/Sign-In/Email", 32],
      ["a doubled slash", "//sign-in/email", 33],
      ["a percent-encoded letter", "/sign-in/%65mail", 34],
    ])(
      "with %s does not reach sign-in past the limit",
      async (_name, spelled, subnet) => {
        const from = { "x-forwarded-for": client(subnet) };
        const email = addressFor(`spelling-${String(subnet)}`);
        await statusesOf(AUTH_RATE_LIMITS.signInEmail.max, () =>
          post("/sign-in/email", { email, password: PASSWORD }, from),
        );

        const response = await post(
          spelled,
          { email, password: PASSWORD },
          from,
        );

        // 429: the same counter. 404: not routed to sign-in at all. Anything
        // else — 401 for a wrong password — means a spelling got a fresh
        // counter and a way around the limit.
        expect([404, 429]).toContain(response.status);
      },
      SLOW,
    );
  });

  describe("a rate-limited password-reset request", () => {
    /** Everything a client can read off a response. */
    const shape = async (response: Response) => ({
      status: response.status,
      statusText: response.statusText,
      body: await response.text(),
      headers: Object.fromEntries(
        [...response.headers.entries()].filter(
          ([name]) => name !== "x-retry-after",
        ),
      ),
      retryAfter: Number(response.headers.get("x-retry-after")),
    });

    it(
      "is indistinguishable for a registered address, an unregistered one and no address at all",
      async () => {
        const registered = addressFor("reset-registered");
        await auth.api.signUpEmail({
          body: { email: registered, password: PASSWORD, name: "Registered" },
        });
        emailSender.clear();
        const unregistered = addressFor("reset-unregistered");
        const { max, window } = AUTH_RATE_LIMITS.requestPasswordReset;

        // Three clients, exhausted identically, each naming one kind of
        // address — so each refusal below is the (max + 1)th request against
        // an equally spent counter.
        const arms = [
          {
            from: client(40),
            body: { email: registered, redirectTo: BASE_URL },
          },
          {
            from: client(41),
            body: { email: unregistered, redirectTo: BASE_URL },
          },
          { from: client(42), body: { redirectTo: BASE_URL } },
        ];
        const lastAdmitted: Awaited<ReturnType<typeof shape>>[] = [];
        for (const arm of arms) {
          let last: Response | undefined;
          for (let request = 0; request < max; request += 1) {
            last?.body?.cancel().catch(() => undefined);
            last = await post("/request-password-reset", arm.body, {
              "x-forwarded-for": arm.from,
            });
          }
          if (last !== undefined) lastAdmitted.push(await shape(last));
        }
        const mailedBeforeRefusals = emailSender.sent.length;

        const refused = [];
        for (const arm of arms) {
          refused.push(
            await shape(
              await post("/request-password-reset", arm.body, {
                "x-forwarded-for": arm.from,
              }),
            ),
          );
        }
        // And on one spent counter, the two addresses one after the other.
        const onOneClient = [
          await shape(
            await post(
              "/request-password-reset",
              { email: registered, redirectTo: BASE_URL },
              { "x-forwarded-for": client(40) },
            ),
          ),
          await shape(
            await post(
              "/request-password-reset",
              { email: unregistered, redirectTo: BASE_URL },
              { "x-forwarded-for": client(40) },
            ),
          ),
        ];

        const withoutRetry = ({
          retryAfter: _retryAfter,
          ...rest
        }: Awaited<ReturnType<typeof shape>>) => rest;
        const [forRegistered, forUnregistered, forNoAddress] =
          refused.map(withoutRetry);

        // The arms really differed before the limit: Better Auth mailed only
        // the registered address, and refused the body with no address.
        expect(mailedBeforeRefusals).toBe(max);
        expect(lastAdmitted[2]?.status).not.toBe(lastAdmitted[0]?.status);
        // Better Auth's own answer already does not tell the two addresses apart.
        expect(lastAdmitted).toHaveLength(arms.length);
        expect({
          status: lastAdmitted[1]?.status,
          body: lastAdmitted[1]?.body,
        }).toEqual({
          status: lastAdmitted[0]?.status,
          body: lastAdmitted[0]?.body,
        });

        expect(forRegistered?.status).toBe(429);
        expect(forUnregistered).toEqual(forRegistered);
        expect(forNoAddress).toEqual(forRegistered);
        expect(onOneClient.map(withoutRetry)).toEqual([
          forRegistered,
          forRegistered,
        ]);

        // `X-Retry-After` is ceil((counter's last admitted request + window −
        // now) / 1 s). It depends on the counter and the clock, never on the
        // address. **The property is agreement for one counter**: the two
        // addresses sent on one spent counter read the same `lastRequest` (a
        // refused request does not move it), so they may differ only by the
        // one second two requests can straddle. The three arms are three
        // counters last admitted at three different moments, so their "when"
        // legitimately differs by however long the arms took to run — and no
        // client can observe two counters — so across arms only the range is
        // asserted.
        for (const response of [...refused, ...onOneClient]) {
          expect(response.retryAfter).toBeGreaterThanOrEqual(window - 60);
          expect(response.retryAfter).toBeLessThanOrEqual(window);
        }
        const [first, second] = onOneClient.map(
          (response) => response.retryAfter,
        );
        expect(
          Math.abs((first ?? 0) - (second ?? Infinity)),
        ).toBeLessThanOrEqual(1);

        // A refused request sends nothing.
        expect(emailSender.sent).toHaveLength(mailedBeforeRefusals);
      },
      SLOW,
    );
  });

  describe("who counts as one client", () => {
    const signIn = (headers: Readonly<Record<string, string>>) =>
      post(
        "/sign-in/email",
        { email: addressFor("who"), password: PASSWORD },
        headers,
      );

    it(
      "still limits requests with no forwarded address, in one shared bucket, apart from a real client",
      async () => {
        // **What this pins, and what it cannot.** In better-auth 1.7.4 a
        // request whose address cannot be read is limited, not skipped, unless
        // `advanced.ipAddress.disableIpTracking` is set — with it,
        // `resolveRateLimitConfig` returns null and the request escapes every
        // limit. This test goes red if that happens, or if an upgrade stops
        // counting such requests. It cannot observe the production key,
        // `no-trusted-ip|/sign-in/email`: under NODE_ENV=test Better Auth
        // substitutes 127.0.0.1 first. That branch is recorded from its
        // source in docs/architecture/auth.md.
        const noAddress = {};

        const admitted = await statusesOf(
          AUTH_RATE_LIMITS.signInEmail.max,
          () => signIn(noAddress),
        );
        const refused = await signIn(noAddress);
        await refused.arrayBuffer();
        const realClient = await signIn({ "x-forwarded-for": `${V4}.60` });
        await realClient.arrayBuffer();

        expect({
          admitted: admitted.filter((status) => status !== 429).length,
          refused: refused.status,
          realClient: realClient.status,
          shared: await storedCount(UNREADABLE_CLIENT_SIGN_IN_KEY),
        }).toEqual({
          admitted: AUTH_RATE_LIMITS.signInEmail.max,
          refused: 429,
          realClient: 401,
          shared: AUTH_RATE_LIMITS.signInEmail.max,
        });
      },
      SLOW,
    );

    it(
      "reads x-vercel-forwarded-for first and x-forwarded-for after it, as client-address.ts does",
      async () => {
        await statusesOf(AUTH_RATE_LIMITS.signInEmail.max, () =>
          signIn({
            "x-vercel-forwarded-for": `${V4}.1`,
            "x-forwarded-for": `${V4}.2`,
          }),
        );

        expect({
          sameClientViaFallbackHeader: (
            await signIn({ "x-forwarded-for": `${V4}.1` })
          ).status,
          sameClientAsIpv4MappedIpv6: (
            await signIn({ "x-vercel-forwarded-for": `::ffff:${V4}.1` })
          ).status,
          theIgnoredHeadersAddress: (
            await signIn({ "x-forwarded-for": `${V4}.2` })
          ).status,
        }).toEqual({
          sameClientViaFallbackHeader: 429,
          sameClientAsIpv4MappedIpv6: 429,
          theIgnoredHeadersAddress: 401,
        });
      },
      SLOW,
    );

    it(
      "groups IPv6 clients by /64, as clientAddressBucket does",
      async () => {
        await statusesOf(AUTH_RATE_LIMITS.signInEmail.max, () =>
          signIn({ "x-forwarded-for": client(50, 1) }),
        );

        expect({
          sameSlash64: (await signIn({ "x-forwarded-for": client(50, 0xbeef) }))
            .status,
          nextSlash64: (await signIn({ "x-forwarded-for": client(51, 1) }))
            .status,
        }).toEqual({ sameSlash64: 429, nextSlash64: 401 });
      },
      SLOW,
    );
  });

  describe("the resend action's per-client-address limit", () => {
    it("counts in claim_rate_limit under its own hashed bucket kind", async () => {
      const secret = `${SUITE_TAG}-secret-of-sufficient-length`;
      const bucket = resendClientBucket(secret, `${V4}.77`);
      const limiter = createResendClientRateLimiter({
        store: createDrizzleClaimRateLimitStore({ db }),
        clock: { now: () => RESEND_NOW },
        secret,
      });

      const admitted: string[] = [];
      for (
        let request = 0;
        request < RESEND_CLIENT_RATE_LIMIT.maxPerWindow;
        request += 1
      ) {
        admitted.push((await limiter.admit(`${V4}.77`)).state);
      }
      const refused = await limiter.admit(`${V4}.77`);

      // This run's bucket only: the secret carries the suite tag, so a row an
      // earlier run left in the same far-future window cannot be read here.
      const rows = await db.execute<{ bucket: string; count: number }>(sql`
        SELECT bucket, count FROM claim_rate_limit
        WHERE window_start = ${RESEND_WINDOW_START} AND bucket = ${bucket}
      `);
      const stored = rows.rows as { bucket: string; count: number }[];

      expect({
        admitted: admitted.filter((state) => state === "admitted").length,
        refused,
        counts: stored.map((row) => row.count),
        bucketKind: bucket.split(":")[0],
        addressStored: bucket.includes(V4),
      }).toEqual({
        admitted: RESEND_CLIENT_RATE_LIMIT.maxPerWindow,
        refused: { state: "rate-limited", retryAfterMs: 40 * 60 * 1000 },
        counts: [RESEND_CLIENT_RATE_LIMIT.maxPerWindow + 1],
        bucketKind: "resend-client",
        addressStored: false,
      });
    });
  });
});
