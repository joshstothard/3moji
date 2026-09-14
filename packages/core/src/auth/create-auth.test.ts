import { createHeldBackgroundTasks } from "../adapters/held-background-tasks";
import type { BackgroundTasks } from "../ports/background-tasks";
import type { VerificationDispatchStore } from "../ports/verification-dispatch-store";
import { createInMemoryVerificationDispatchStore } from "../adapters/in-memory-verification-dispatch-store";
import { createDatabase } from "../db/client";
import { createRecordingEmailSender } from "./adapters/recording-email-sender";
import {
  authClientAddressOptions,
  authRateLimitOptions,
} from "./auth-rate-limit";
import { createAuth } from "./create-auth";
import {
  createBackgroundEmailSender,
  DEFERRED_EMAIL_FAILURE_EVENTS,
} from "./adapters/background-email-sender";
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from "./password-length";

const SECRET = "a".repeat(32);
const BASE_URL = "http://localhost:3000";
const DB_URL = "postgresql://app:app@localhost:5432/app_test";

const NOW = new Date("2026-09-12T12:00:00.000Z");

const build = (overrides: Partial<Parameters<typeof createAuth>[0]> = {}) => {
  const emailSender = createRecordingEmailSender();
  const dispatches = createInMemoryVerificationDispatchStore();
  const handle = createDatabase({ url: DB_URL, nodeEnv: "test" });
  const auth = createAuth({
    db: handle.db,
    emailSender,
    dispatches,
    clock: { now: () => NOW },
    baseUrl: BASE_URL,
    secret: SECRET,
    from: "3moji <no-reply@mail.3moji.me>",
    ...overrides,
  });
  return { auth, emailSender, dispatches, close: handle.close };
};

describe("createAuth", () => {
  describe("the settings ADR-0006 calls load-bearing", () => {
    it("requires email verification, so sign-up yields no session", async () => {
      const { auth, close } = build();
      expect(auth.options.emailAndPassword.requireEmailVerification).toBe(true);
      await close();
    });

    it("signs the user in after verification, which is not a default", async () => {
      const { auth, close } = build();
      // Without this, following the verification link verifies the account and
      // drops the user at a sign-in page instead of the Profile they claimed.
      expect(auth.options.emailVerification.autoSignInAfterVerification).toBe(
        true,
      );
      await close();
    });

    it("sends the verification email on sign-up", async () => {
      const { auth, close } = build();
      expect(auth.options.emailVerification.sendOnSignUp).toBe(true);
      await close();
    });

    it("revokes every session when a password is reset", async () => {
      const { auth, close } = build();
      expect(auth.options.emailAndPassword.revokeSessionsOnPasswordReset).toBe(
        true,
      );
      await close();
    });
  });

  describe("email", () => {
    it("sends verification mail through the injected sender", async () => {
      const { auth, emailSender, close } = build();

      await auth.options.emailVerification.sendVerificationEmail({
        user: { id: "u1", email: "someone@example.com" },
        url: `${BASE_URL}/api/auth/verify-email?token=abc`,
        token: "abc",
      } as never);

      expect(emailSender.lastSent()?.to).toBe("someone@example.com");
      expect(emailSender.lastSent()?.text).toContain("token=abc");
      await close();
    });

    it("sends reset mail through the injected sender", async () => {
      const { auth, emailSender, close } = build();

      await auth.options.emailAndPassword.sendResetPassword({
        user: { id: "u1", email: "reset@example.com" },
        url: `${BASE_URL}/api/auth/reset-password/xyz?callbackURL=`,
        token: "xyz",
      } as never);

      expect(emailSender.lastSent()?.to).toBe("reset@example.com");
      await close();
    });

    it("links a reset to our own page, with the token as a path segment rather than Better Auth's callback (#192)", async () => {
      const { auth, emailSender, close } = build();

      await auth.options.emailAndPassword.sendResetPassword({
        user: { id: "u1", email: "reset@example.com" },
        url: `${BASE_URL}/api/auth/reset-password/tok_en-1?callbackURL=`,
        token: "tok_en-1",
      } as never);

      const text = emailSender.lastSent()?.text ?? "";
      const links = text.match(/https?:\/\/\S+/g);
      expect(links).toEqual([`${BASE_URL}/reset-password/tok_en-1`]);
      expect(text).not.toContain("/api/auth/");
      expect(text).not.toContain("token=");
      expect(emailSender.lastSent()?.subject).not.toContain("tok_en-1");
      await close();
    });

    it("states the password lengths the set-new-password form tells the browser (#192)", async () => {
      const { auth, close } = build();

      expect(auth.options.emailAndPassword.minPasswordLength).toBe(
        PASSWORD_MIN_LENGTH,
      );
      expect(auth.options.emailAndPassword.maxPasswordLength).toBe(
        PASSWORD_MAX_LENGTH,
      );
      expect([PASSWORD_MIN_LENGTH, PASSWORD_MAX_LENGTH]).toEqual([8, 128]);
      await close();
    });

    it("sends verification mail as multipart text and HTML (#240)", async () => {
      const { auth, emailSender, close } = build();

      await auth.options.emailVerification.sendVerificationEmail({
        user: { id: "u1", email: "someone@example.com" },
        url: `${BASE_URL}/api/auth/verify-email?token=abc`,
        token: "abc",
      } as never);

      const sent = emailSender.lastSent();
      const link = `${BASE_URL}/claim/verify?token=abc`;
      expect(sent?.text).toContain(link);
      expect(sent?.html).toContain('<html lang="en">');
      expect(sent?.html).toContain(`href="${link}"`);
      await close();
    });

    it("sends reset mail as multipart text and HTML (#240)", async () => {
      const { auth, emailSender, close } = build();

      await auth.options.emailAndPassword.sendResetPassword({
        user: { id: "u1", email: "reset@example.com" },
        url: `${BASE_URL}/api/auth/reset-password/xyz?callbackURL=`,
        token: "xyz",
      } as never);

      const sent = emailSender.lastSent();
      const link = `${BASE_URL}/reset-password/xyz`;
      expect(sent?.text).toContain(link);
      expect(sent?.html).toContain('<html lang="en">');
      expect(sent?.html).toContain(`href="${link}"`);
      await close();
    });

    it("escapes the sender in the HTML part (#240)", async () => {
      const { auth, emailSender, close } = build();

      await auth.options.emailAndPassword.sendResetPassword({
        user: { id: "u1", email: "reset@example.com" },
        url: `${BASE_URL}/api/auth/reset-password/xyz?callbackURL=`,
        token: "xyz",
      } as never);

      const html = emailSender.lastSent()?.html ?? "";
      expect(html).not.toContain("<no-reply@mail.3moji.me>");
      expect(html).toContain("3moji &lt;no-reply@mail.3moji.me&gt;");
      await close();
    });

    it("never puts the raw token in the subject line", async () => {
      const { auth, emailSender, close } = build();

      await auth.options.emailVerification.sendVerificationEmail({
        user: { id: "u1", email: "someone@example.com" },
        url: `${BASE_URL}/api/auth/verify-email?token=secret-token`,
        token: "secret-token",
      } as never);

      expect(emailSender.lastSent()?.subject).not.toContain("secret-token");
      await close();
    });
  });

  describe("guards", () => {
    it("refuses a secret short enough to brute force", () => {
      expect(() => build({ secret: "tooshort" })).toThrow(/secret/i);
    });

    it("refuses an empty base URL", () => {
      expect(() => build({ baseUrl: "" })).toThrow(/base url/i);
    });
  });

  describe("the HTTP surface (#150)", () => {
    // DB_URL has nothing listening on it here, so an answer that is the same
    // whatever the body proves the refusal is decided before any database read.
    const post = (auth: ReturnType<typeof build>["auth"], pathname: string) =>
      auth.handler(
        new Request(`${BASE_URL}${pathname}`, {
          method: "POST",
          headers: { "content-type": "application/json", origin: BASE_URL },
          body: JSON.stringify({
            email: "someone@example.com",
            password: "correct horse battery staple",
            name: "Someone",
          }),
        }),
      );

    it.each(["/api/auth/sign-up/email", "/api/auth/sign-in/social"])(
      "refuses %s before it reaches Better Auth, so only the Claim creates Accounts",
      async (pathname) => {
        const { auth, emailSender, close } = build();

        const response = await post(auth, pathname);

        expect({
          status: response.status,
          body: await response.text(),
        }).toEqual({ status: 404, body: "Not Found" });
        expect(emailSender.sent).toHaveLength(0);
        await close();
      },
    );

    it("leaves the server-side sign-up the Claim calls enabled", async () => {
      const { auth, close } = build();
      // `disableSignUp` would also refuse `auth.api.signUpEmail`, which the
      // Claim runs inside its transaction — measured in
      // direct-sign-up.integration.test.ts.
      expect(Object.keys(auth.options.emailAndPassword)).not.toContain(
        "disableSignUp",
      );
      await close();
    });
  });

  describe("rate limiting (#158)", () => {
    it("is enabled here, under NODE_ENV=test, where Better Auth's own default is off", async () => {
      // better-auth 1.7.4 resolves `enabled` to `options.rateLimit?.enabled ??
      // isProduction`, so without an explicit `true` every non-production
      // environment — previews included — would run unlimited.
      const { auth, close } = build();
      const context = await auth.$context;

      expect({
        enabled: context.rateLimit.enabled,
        storage: context.rateLimit.storage,
      }).toEqual({ enabled: true, storage: "database" });
      await close();
    });

    it("configures the rules, the table and the client-address headers from one place", async () => {
      const { auth, close } = build();

      expect(auth.options.rateLimit).toEqual(authRateLimitOptions());
      expect(auth.options.advanced.ipAddress).toEqual(
        authClientAddressOptions(),
      );
      await close();
    });
  });

  it("accepts transport plugins from the caller, keeping core framework-free", async () => {
    // apps/web passes nextCookies() here. packages/core must never import it.
    const marker = { id: "marker-plugin" };
    const { auth, close } = build({ plugins: [marker] });

    expect(auth.options.plugins).toContainEqual(marker);
    await close();
  });
});

/**
 * **Resend's invalidation order survives the move to the background**
 * ([#216](https://github.com/joshstothard/3moji/issues/216)).
 * `docs/architecture/auth.md` records why the dispatch row is written before
 * the send. With the sender the composition root wires, the send is handed to
 * the background after that awaited write, and reaches the provider later.
 */
describe("createAuth with the background sender the composition root wires (#216)", () => {
  const USER = {
    id: "user-1",
    name: "",
    email: "owner@example.com",
    emailVerified: false,
    createdAt: NOW,
    updatedAt: NOW,
  };

  it("records the verification dispatch before the send is handed to the background, and the provider sees nothing until it runs", async () => {
    const provider = createRecordingEmailSender();
    const order: string[] = [];
    const held = createHeldBackgroundTasks();
    const tasks: BackgroundTasks = {
      run: (event, task) => {
        order.push("schedule:" + event);
        held.run(event, task);
      },
    };
    const inMemory = createInMemoryVerificationDispatchStore();
    const dispatches: VerificationDispatchStore = {
      ...inMemory,
      record: (dispatch) => {
        order.push("record");
        return inMemory.record(dispatch);
      },
    };
    const { auth, close } = build({
      emailSender: createBackgroundEmailSender({
        inner: provider,
        tasks,
        event: DEFERRED_EMAIL_FAILURE_EVENTS.auth,
      }),
      dispatches,
    });

    await auth.options.emailVerification.sendVerificationEmail({
      user: USER,
      url: "http://localhost:3000/api/auth/verify-email?token=token",
      token: "token",
    });

    expect(order).toEqual(["record", "schedule:auth_email_send_failed"]);
    expect(provider.sent).toHaveLength(0);
    await held.release();
    expect(provider.sent.map((email) => email.to)).toEqual([USER.email]);
    await close();
  });
});
