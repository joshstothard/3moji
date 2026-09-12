import { createDatabase } from "../db/client";
import { createRecordingEmailSender } from "./adapters/recording-email-sender";
import { createAuth } from "./create-auth";

const SECRET = "a".repeat(32);
const BASE_URL = "http://localhost:3000";
const DB_URL = "postgresql://app:app@localhost:5432/app_test";

const build = (overrides: Partial<Parameters<typeof createAuth>[0]> = {}) => {
  const emailSender = createRecordingEmailSender();
  const handle = createDatabase({ url: DB_URL, nodeEnv: "test" });
  const auth = createAuth({
    db: handle.db,
    emailSender,
    baseUrl: BASE_URL,
    secret: SECRET,
    from: "3moji <no-reply@mail.3moji.me>",
    ...overrides,
  });
  return { auth, emailSender, close: handle.close };
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
        url: `${BASE_URL}/api/auth/reset-password?token=xyz`,
        token: "xyz",
      } as never);

      expect(emailSender.lastSent()?.to).toBe("reset@example.com");
      expect(emailSender.lastSent()?.text).toContain("token=xyz");
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

  it("accepts transport plugins from the caller, keeping core framework-free", async () => {
    // apps/web passes nextCookies() here. packages/core must never import it.
    const marker = { id: "marker-plugin" };
    const { auth, close } = build({ plugins: [marker] });

    expect(auth.options.plugins).toContainEqual(marker);
    await close();
  });
});
