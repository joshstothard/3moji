/**
 * @jest-environment node
 */

/**
 * Where each password reset answer sends the visitor
 * ([#192](https://github.com/joshstothard/3moji/issues/192)).
 *
 * Transport behaviour only: `@template/core`'s use cases are faked, because
 * the rules are theirs and are tested beside them. What is under test here is
 * the redirect each answer becomes, and that a failure is logged without the
 * values it was handed.
 */
const requestPasswordReset = jest.fn();
const setNewPassword = jest.fn();
jest.mock("@template/core", () => ({
  requestPasswordReset: (input: unknown): unknown =>
    requestPasswordReset(input),
  setNewPassword: (input: unknown): unknown => setNewPassword(input),
}));

const services = {
  resetRequestClientRateLimiter: { admit: jest.fn() },
  passwordResetter: { request: jest.fn(), reset: jest.fn() },
  clock: { now: () => new Date(0) },
};
jest.mock("../lib/services", () => ({ getServices: () => services }));

const CLIENT = "203.0.113.7";
jest.mock("next/headers", () => ({
  headers: () =>
    Promise.resolve(new Headers({ "x-vercel-forwarded-for": CLIENT })),
}));

const redirect = jest.fn((_url: string): undefined => undefined);
jest.mock("next/navigation", () => ({
  redirect: (url: string): undefined => {
    redirect(url);
  },
}));

import {
  requestPasswordResetFormAction,
  setNewPasswordFormAction,
} from "./password-reset-action";

const EMAIL = "owner@example.com";
const TOKEN = "Abc123Token456Xyz789Qrst";
const PASSWORD = "a brand new passphrase";

function form(fields: Readonly<Record<string, string>>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

const written: string[] = [];

beforeEach(() => {
  jest.clearAllMocks();
  written.length = 0;
  for (const stream of ["log", "error"] as const) {
    jest.spyOn(console, stream).mockImplementation((...args: unknown[]) => {
      written.push(args.map(String).join(" "));
    });
  }
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("requestPasswordResetFormAction", () => {
  it("hands the domain the typed address, the client address and the bound limiter and resetter", async () => {
    requestPasswordReset.mockResolvedValue({ state: "sent" });

    await requestPasswordResetFormAction(form({ email: EMAIL }));

    expect(requestPasswordReset).toHaveBeenCalledWith(
      expect.objectContaining({
        email: EMAIL,
        clientAddress: CLIENT,
        clientLimiter: services.resetRequestClientRateLimiter,
        resetter: services.passwordResetter,
        clock: services.clock,
      }),
    );
  });

  it.each(["sent", "invalid", "rate-limited"] as const)(
    "redirects %s back to the form as a notice, never carrying the address",
    async (state) => {
      requestPasswordReset.mockResolvedValue({ state });

      await requestPasswordResetFormAction(form({ email: EMAIL }));

      expect(redirect.mock.calls).toEqual([
        [`/reset-password?notice=${state}`],
      ]);
      expect(redirect.mock.calls[0]?.[0]).not.toContain("example.com");
    },
  );

  it("counts a submission with no email field like any other, as an empty address", async () => {
    requestPasswordReset.mockResolvedValue({ state: "invalid" });

    await requestPasswordResetFormAction(form({}));

    expect(requestPasswordReset).toHaveBeenCalledWith(
      expect.objectContaining({ email: "" }),
    );
  });

  it("answers failed when the domain throws, logging without the address", async () => {
    requestPasswordReset.mockRejectedValue(
      new Error(`Key (email)=(${EMAIL}) exploded`),
    );

    await requestPasswordResetFormAction(form({ email: EMAIL }));

    expect(redirect.mock.calls).toEqual([["/reset-password?notice=failed"]]);
    const everything = written.join("\n");
    expect(everything).toContain("password_reset_request_failed");
    expect(everything).not.toContain(EMAIL);
    expect(everything).not.toContain(CLIENT);
  });
});

describe("setNewPasswordFormAction", () => {
  const submit = () =>
    setNewPasswordFormAction(form({ token: TOKEN, password: PASSWORD }));

  it("hands the domain the token and the new password", async () => {
    setNewPassword.mockResolvedValue({ state: "reset" });

    await submit();

    expect(setNewPassword).toHaveBeenCalledWith(
      expect.objectContaining({
        token: TOKEN,
        newPassword: PASSWORD,
        resetter: services.passwordResetter,
      }),
    );
  });

  it.each([
    ["reset", "/sign-in?notice=password-reset"],
    ["invalid-link", "/reset-password?notice=link-invalid"],
    ["password-too-short", `/reset-password/${TOKEN}?error=too-short`],
    ["password-too-long", `/reset-password/${TOKEN}?error=too-long`],
  ] as const)("redirects %s to %s", async (state, destination) => {
    setNewPassword.mockResolvedValue({ state });

    await submit();

    expect(redirect.mock.calls).toEqual([[destination]]);
  });

  it("sends an invalid link to the request form, leaving the dead token out of the address", async () => {
    setNewPassword.mockResolvedValue({ state: "invalid-link" });

    await submit();

    expect(redirect.mock.calls[0]?.[0]).not.toContain(TOKEN);
  });

  it("percent-encodes a crafted token into one path segment, so it cannot leave the route", async () => {
    setNewPassword.mockResolvedValue({ state: "password-too-short" });

    await setNewPasswordFormAction(
      form({ token: "../../evil?x=1#y", password: "short" }),
    );

    expect(redirect.mock.calls).toEqual([
      [
        `/reset-password/${encodeURIComponent("../../evil?x=1#y")}?error=too-short`,
      ],
    ]);
  });

  it("answers failed back at the link when the domain throws, logging no token or password", async () => {
    setNewPassword.mockRejectedValue(new Error(`${TOKEN} ${PASSWORD}`));

    await submit();

    expect(redirect.mock.calls).toEqual([
      [`/reset-password/${TOKEN}?error=failed`],
    ]);
    const everything = written.join("\n");
    expect(everything).toContain("password_reset_set_failed");
    expect(everything).not.toContain(TOKEN);
    expect(everything).not.toContain(PASSWORD);
  });

  it("sends a failure with no token to the request form rather than a broken link", async () => {
    setNewPassword.mockRejectedValue(new Error("unreachable"));

    await setNewPasswordFormAction(form({ password: PASSWORD }));

    expect(redirect.mock.calls).toEqual([
      ["/reset-password?notice=link-invalid"],
    ]);
  });
});
