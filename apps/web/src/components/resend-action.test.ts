/**
 * @jest-environment node
 */

/**
 * The resend endpoint, as a server action.
 *
 * `@template/core` is mocked because its root entry point cannot be `require`d
 * under this suite (better-auth is ESM-only), and it is the right boundary
 * anyway: **every rule lives in the domain**, so what belongs here is which
 * dependencies the action hands the use case, and how it turns the answer into
 * a URL. The limits themselves are proved in
 * `packages/core/src/auth/resend-allowance.test.ts` and against real rows in
 * `verification.integration.test.ts`.
 */
interface ResendInput {
  readonly email: string;
  readonly clientAddress: string | undefined;
  readonly clientLimiter: unknown;
  readonly directory: unknown;
  readonly dispatches: unknown;
  readonly mailer: unknown;
  readonly clock: unknown;
}

type Outcome =
  | { readonly state: "sent" }
  | { readonly state: "too-soon"; readonly retryAfterMs: number }
  | { readonly state: "too-many"; readonly retryAfterMs: number };

const ICE = "\u{1F9CA}\u{1F9CA}\u{1F9CA}";
const ENCODED = "%F0%9F%A7%8A%F0%9F%A7%8A%F0%9F%A7%8A";

const resendVerification = jest.fn((_input: ResendInput): Promise<Outcome> =>
  Promise.resolve({ state: "sent" }),
);

/** The real canonicalise, near enough: it is proved in packages/core. */
const canonicalise = jest.fn((segment: string) =>
  segment === ICE || segment === ENCODED
    ? { ok: true, key: ICE, encoded: ENCODED, isCanonical: true }
    : { ok: false, failure: { reason: "unknown-codepoint" } },
);

jest.mock("@template/core", () => ({
  resendVerification: (input: ResendInput) => resendVerification(input),
  canonicalise: (segment: string) => canonicalise(segment),
}));

const CLOCK = { now: () => new Date(0) };
const ACCOUNTS = { byEmail: jest.fn(), handleOf: jest.fn() };
const DISPATCHES = { record: jest.fn() };
const MAILER = { send: jest.fn() };
const RESEND_CLIENT_LIMITER = { admit: jest.fn() };

const getServices = jest.fn(() => ({
  clock: CLOCK,
  accounts: ACCOUNTS,
  dispatches: DISPATCHES,
  verificationMailer: MAILER,
  resendClientRateLimiter: RESEND_CLIENT_LIMITER,
}));
jest.mock("../lib/services", () => ({
  getServices: () => getServices(),
}));

/** The request's headers, as the forwarded-for header Vercel sets them. */
let requestHeaders = new Headers({ "x-vercel-forwarded-for": "203.0.113.7" });
jest.mock("next/headers", () => ({
  headers: () => Promise.resolve(requestHeaders),
}));

/** Typed, so `redirect.mock.calls` is typed too and no assertion is needed. */
const redirect = jest.fn((_url: string): undefined => undefined);
jest.mock("next/navigation", () => ({
  redirect: (url: string): undefined => {
    redirect(url);
  },
}));

import { requestNewVerificationLink } from "./resend-action";

const form = (fields: Readonly<Record<string, string>>): FormData => {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    data.set(key, value);
  }
  return data;
};

/** The single URL the action redirected to. */
const redirectedTo = (): string => {
  expect(redirect).toHaveBeenCalledTimes(1);
  return redirect.mock.calls[0]?.[0] ?? "";
};

describe("requestNewVerificationLink", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resendVerification.mockResolvedValue({ state: "sent" });
  });

  it("hands the use case the wired collaborators and the trimmed address", async () => {
    await requestNewVerificationLink(
      form({ email: "  claimant@example.com  ", handle: ENCODED }),
    );

    expect(resendVerification).toHaveBeenCalledWith({
      email: "claimant@example.com",
      clientAddress: "203.0.113.7",
      clientLimiter: RESEND_CLIENT_LIMITER,
      directory: ACCOUNTS,
      dispatches: DISPATCHES,
      mailer: MAILER,
      clock: CLOCK,
    });
  });

  it("hands the per-client-address limit the address the forwarded headers state (#158)", async () => {
    requestHeaders = new Headers({ "x-forwarded-for": "198.51.100.1" });

    await requestNewVerificationLink(
      form({ email: "claimant@example.com", handle: ENCODED }),
    );

    requestHeaders = new Headers({ "x-vercel-forwarded-for": "203.0.113.7" });
    expect(resendVerification.mock.calls[0]?.[0].clientAddress).toBe(
      "198.51.100.1",
    );
  });

  it("comes back to that Handle's hold screen with the answer", async () => {
    await requestNewVerificationLink(
      form({
        email: "claimant@example.com",
        handle: ENCODED,
        reason: "link-expired",
      }),
    );

    expect(redirectedTo()).toBe(
      `/claim/held/${ENCODED}?reason=link-expired&notice=sent`,
    );
  });

  it("puts the address in neither the URL nor the query string", async () => {
    // Personal data never travels in a query string. The notice says what
    // happened; nothing says who it happened to.
    await requestNewVerificationLink(
      form({ email: "claimant@example.com", handle: ENCODED }),
    );

    expect(redirectedTo()).not.toContain("claimant");
    expect(redirectedTo()).not.toContain("@");
  });

  it("re-canonicalises the Handle rather than trusting the form", async () => {
    // A hidden field is public input, and a value put straight into a Location
    // header is a redirect anybody can aim.
    await requestNewVerificationLink(
      form({
        email: "claimant@example.com",
        handle: "https://evil.example.com",
      }),
    );

    expect(redirectedTo()).toBe("/claim/held?reason=pending&notice=sent");
  });

  it("whitelists the reason, so a crafted value cannot fake a lost hold", async () => {
    await requestNewVerificationLink(
      form({ email: "a@b.com", handle: ENCODED, reason: "hold-expired-lol" }),
    );

    expect(redirectedTo()).toContain("reason=pending");
  });

  it("carries the retry hint when the minute limit refused", async () => {
    resendVerification.mockResolvedValue({
      state: "too-soon",
      retryAfterMs: 44_400,
    });

    await requestNewVerificationLink(
      form({ email: "a@b.com", handle: ENCODED, reason: "pending" }),
    );

    // Rounded up to whole seconds: 44.4 becomes 45, so the hint never expires
    // a moment before the limit does.
    expect(redirectedTo()).toBe(
      `/claim/held/${ENCODED}?reason=pending&notice=too-soon&retry=45`,
    );
  });

  it("carries the retry hint when the hour limit refused", async () => {
    resendVerification.mockResolvedValue({
      state: "too-many",
      retryAfterMs: 600_000,
    });

    await requestNewVerificationLink(
      form({ email: "a@b.com", handle: ENCODED }),
    );

    expect(redirectedTo()).toContain("notice=too-many&retry=600");
  });

  it("asks again rather than calling the domain when the field is empty", async () => {
    await requestNewVerificationLink(form({ email: "   ", handle: ENCODED }));

    expect(resendVerification).not.toHaveBeenCalled();
    expect(redirectedTo()).toContain("notice=invalid");
  });

  it("asks again when there is no email field at all", async () => {
    await requestNewVerificationLink(form({ handle: ENCODED }));

    expect(resendVerification).not.toHaveBeenCalled();
    expect(redirectedTo()).toContain("notice=invalid");
  });

  it("does not claim a link is coming when the send threw", async () => {
    // A misconfigured deployment or an unreachable database. Saying "sent"
    // would leave somebody waiting for an email that never arrives.
    const logged = jest
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    resendVerification.mockRejectedValue(
      new Error("RESEND_API_KEY is not set"),
    );

    await requestNewVerificationLink(
      form({ email: "a@b.com", handle: ENCODED }),
    );

    expect(redirectedTo()).toContain("notice=failed");
    expect(logged).toHaveBeenCalledWith(
      expect.stringContaining("verification_resend_failed"),
    );
    logged.mockRestore();
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
      resendVerification.mockRejectedValue(new Error(message));
      await requestNewVerificationLink(
        form({ email: "a@b.com", handle: ENCODED }),
      );
      const output = JSON.stringify(logged.mock.calls);
      expect(output).toContain("verification_resend_failed");
      expect(output).not.toContain(secret);
      logged.mockRestore();
    },
  );

  it("keeps the API key out of the log line", async () => {
    // The message reaches logs and error trackers.
    const logged = jest
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    resendVerification.mockRejectedValue(
      new Error("Resend rejected the request with status 401."),
    );

    await requestNewVerificationLink(
      form({ email: "a@b.com", handle: ENCODED }),
    );

    const line: unknown = logged.mock.calls[0]?.[0];
    expect(typeof line === "string" ? line : "").not.toMatch(/re_[A-Za-z0-9]/);
    logged.mockRestore();
  });
});
