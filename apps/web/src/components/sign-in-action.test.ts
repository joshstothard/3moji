/**
 * @jest-environment node
 */

/**
 * Sign-in, and the 403 that must not look like an error.
 *
 * `@template/core` is mocked because its root entry point is ESM-only under
 * this suite. The behaviour under test is transport behaviour: which URL an
 * unverified Account is sent to, and what a wrong password does instead.
 */
const ICE = "\u{1F9CA}\u{1F9CA}\u{1F9CA}";
const ENCODED = "%F0%9F%A7%8A%F0%9F%A7%8A%F0%9F%A7%8A";

const canonicalise = jest.fn((segment: string) =>
  segment === ICE
    ? { ok: true, key: ICE, encoded: ENCODED, isCanonical: true }
    : { ok: false, failure: { reason: "unknown-codepoint" } },
);
jest.mock("@template/core", () => ({
  canonicalise: (segment: string) => canonicalise(segment),
}));

const signInEmail = jest.fn();
const byEmail = jest.fn();
const handleOf = jest.fn();

const getServices = jest.fn(() => ({
  auth: { api: { signInEmail } },
  accounts: { byEmail, handleOf },
}));
jest.mock("../lib/services", () => ({
  getServices: () => getServices(),
}));

/** Typed, so `redirect.mock.calls` is typed too and no assertion is needed. */
const redirect = jest.fn((_url: string): undefined => undefined);
jest.mock("next/navigation", () => ({
  redirect: (url: string): undefined => {
    redirect(url);
  },
}));

import { signInAction, signInFormAction } from "./sign-in-action";

const form = (fields: Readonly<Record<string, string>>): FormData => {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    data.set(key, value);
  }
  return data;
};

/** Better Auth's refusal for an unverified Account. */
const emailNotVerified = (): unknown => ({
  status: "FORBIDDEN",
  body: { code: "EMAIL_NOT_VERIFIED", message: "Email not verified" },
});

/** Better Auth's refusal for a wrong password. */
const badCredentials = (): unknown => ({
  status: "UNAUTHORIZED",
  body: { code: "INVALID_EMAIL_OR_PASSWORD" },
});

const CREDENTIALS = { email: "claimant@example.com", password: "hunter22222" };

describe("signInAction", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    signInEmail.mockResolvedValue({ token: "session" });
    byEmail.mockResolvedValue({
      userId: "user-1",
      email: CREDENTIALS.email,
      emailVerified: false,
    });
    handleOf.mockResolvedValue({
      key: ICE,
      heldUntil: new Date("2026-09-13T12:00:00.000Z"),
      claimedAt: null,
    });
  });

  it("signs in and lands them somewhere, on the happy path", async () => {
    await signInAction(form(CREDENTIALS));

    expect(signInEmail).toHaveBeenCalledWith({
      body: { email: CREDENTIALS.email, password: CREDENTIALS.password },
    });
    expect(redirect).toHaveBeenCalledWith("/");
  });

  describe("the 403 before verification", () => {
    it("sends them to their own hold screen rather than an error", async () => {
      // #82: Better Auth returns 403 and that must not surface as a failure.
      signInEmail.mockRejectedValue(emailNotVerified());

      const result = await signInAction(form(CREDENTIALS));

      expect(redirect).toHaveBeenCalledWith(
        `/claim/held/${ENCODED}?reason=unverified`,
      );
      // Not a rejection: nothing went wrong.
      expect(result).toBeUndefined();
    });

    it("recognises the refusal by status code as well as by name", async () => {
      // Some versions carry a number, some a name. Both are the same refusal.
      signInEmail.mockRejectedValue({ status: 403, body: {} });

      await signInAction(form(CREDENTIALS));

      expect(redirect).toHaveBeenCalledWith(
        `/claim/held/${ENCODED}?reason=unverified`,
      );
    });

    it("recognises it by body code when the status is something else", async () => {
      signInEmail.mockRejectedValue({
        status: "BAD_REQUEST",
        body: { code: "EMAIL_NOT_VERIFIED" },
      });

      await signInAction(form(CREDENTIALS));

      expect(redirect).toHaveBeenCalledWith(
        `/claim/held/${ENCODED}?reason=unverified`,
      );
    });

    it("falls back to the anonymous hold screen when there is no Handle", async () => {
      signInEmail.mockRejectedValue(emailNotVerified());
      handleOf.mockResolvedValue(undefined);

      await signInAction(form(CREDENTIALS));

      expect(redirect).toHaveBeenCalledWith("/claim/held?reason=unverified");
    });

    it("falls back to the anonymous hold screen when the address is unknown", async () => {
      signInEmail.mockRejectedValue(emailNotVerified());
      byEmail.mockResolvedValue(undefined);

      await signInAction(form(CREDENTIALS));

      expect(redirect).toHaveBeenCalledWith("/claim/held?reason=unverified");
    });

    it("puts no address in the URL it sends them to", async () => {
      signInEmail.mockRejectedValue(emailNotVerified());

      await signInAction(form(CREDENTIALS));

      expect(redirect.mock.calls[0]?.[0] ?? "").not.toContain("claimant");
    });

    it.each([
      [
        "an email address",
        `Key (email)=(someone@example.com) already exists.`,
        "someone@example.com",
      ],
      [
        "a password",
        `password authentication failed: "hunter2-Tr0ub4dor&3"`,
        "hunter2-Tr0ub4dor&3",
      ],
    ])(
      "keeps %s in the error's message out of the log line (#134)",
      async (_what, message, secret) => {
        const logged = jest
          .spyOn(console, "error")
          .mockImplementation(() => undefined);
        signInEmail.mockRejectedValue(emailNotVerified());
        byEmail.mockRejectedValue(new Error(message));
        await signInAction(form(CREDENTIALS));
        const output = JSON.stringify(logged.mock.calls);
        expect(output).toContain("hold_screen_lookup_failed");
        expect(output).not.toContain(secret);
        logged.mockRestore();
      },
    );

    it("reports a failure rather than a wrong guess when the lookup breaks", async () => {
      const logged = jest
        .spyOn(console, "error")
        .mockImplementation(() => undefined);
      signInEmail.mockRejectedValue(emailNotVerified());
      byEmail.mockRejectedValue(new Error("connect ECONNREFUSED"));

      const result = await signInAction(form(CREDENTIALS));

      expect(result).toEqual({ state: "failed" });
      expect(redirect).not.toHaveBeenCalled();
      expect(logged).toHaveBeenCalledWith(
        expect.stringContaining("hold_screen_lookup_failed"),
      );
      logged.mockRestore();
    });
  });

  describe("a wrong password", () => {
    it("stays on the form and says nothing about which half was wrong", async () => {
      signInEmail.mockRejectedValue(badCredentials());

      const result = await signInAction(form(CREDENTIALS));

      expect(result).toEqual({ state: "invalid" });
      expect(redirect).not.toHaveBeenCalled();
      // No lookup happened, so nothing about the address was even read.
      expect(byEmail).not.toHaveBeenCalled();
    });

    it("refuses an empty form without asking Better Auth", async () => {
      const result = await signInAction(form({ email: "", password: "" }));

      expect(result).toEqual({ state: "invalid" });
      expect(signInEmail).not.toHaveBeenCalled();
    });

    it("refuses a form with no fields at all", async () => {
      const result = await signInAction(new FormData());

      expect(result).toEqual({ state: "invalid" });
      expect(signInEmail).not.toHaveBeenCalled();
    });
  });
});

describe("signInFormAction", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    byEmail.mockResolvedValue(undefined);
  });

  it("comes back to the form with the reason, so it works without JavaScript", async () => {
    signInEmail.mockRejectedValue(badCredentials());

    await signInFormAction(form(CREDENTIALS));

    expect(redirect).toHaveBeenCalledWith("/sign-in?error=invalid");
  });

  it("carries no address back with it", async () => {
    signInEmail.mockRejectedValue(badCredentials());

    await signInFormAction(form(CREDENTIALS));

    expect(redirect.mock.calls[0]?.[0] ?? "").not.toContain("@");
  });
});
