/**
 * @jest-environment node
 */

/**
 * The claim submission, as a server action.
 *
 * The non-enumeration promise is **not** tested here, and that is the point:
 * `submitClaim` collapses an already-registered address into `pending` before
 * this action sees it, so there is no branch here that could leak. What belongs
 * in this file is which dependencies the action hands the domain, and that one
 * `pending` becomes one URL.
 */
const ICE = "\u{1F9CA}\u{1F9CA}\u{1F9CA}";
const ENCODED = "%F0%9F%A7%8A%F0%9F%A7%8A%F0%9F%A7%8A";

interface SubmitInput {
  readonly segment: string;
  readonly email: string;
  readonly password: string;
  readonly store: unknown;
  readonly clock: unknown;
  readonly directory: unknown;
  readonly emailSender: unknown;
  readonly resetRequestUrl: string;
  readonly from: string;
}

type Submission =
  | { readonly state: "pending"; readonly handle: { readonly encoded: string } }
  | { readonly state: "taken"; readonly because: string }
  | { readonly state: "not-claimable" }
  | { readonly state: "not-a-handle" };

const submitClaim = jest.fn((_input: SubmitInput): Promise<Submission> =>
  Promise.resolve({ state: "pending", handle: { encoded: ENCODED } }),
);
jest.mock("@template/core", () => ({
  submitClaim: (input: SubmitInput) => submitClaim(input),
}));

const CLOCK = { now: () => new Date(0) };
const CLAIMS = { runInTransaction: jest.fn() };
const ACCOUNTS = { byEmail: jest.fn(), handleOf: jest.fn() };
const SENDER = { send: jest.fn() };

const getServices = jest.fn(() => ({
  clock: CLOCK,
  claims: CLAIMS,
  accounts: ACCOUNTS,
  emailSender: SENDER,
  resetRequestUrl: "http://localhost:3000/reset-password",
  emailFrom: "3moji <no-reply@mail.3moji.me>",
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

import { submitClaimAction } from "./claim-action";

const form = (fields: Readonly<Record<string, string>>): FormData => {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    data.set(key, value);
  }
  return data;
};

const FIELDS = {
  handle: ICE,
  email: "  claimant@example.com ",
  password: "correct horse battery staple",
};

describe("submitClaimAction", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    submitClaim.mockResolvedValue({
      state: "pending",
      handle: { encoded: ENCODED },
    });
  });

  it("hands the domain the wired collaborators and the trimmed address", async () => {
    await submitClaimAction(form(FIELDS));

    expect(submitClaim).toHaveBeenCalledWith({
      segment: ICE,
      email: "claimant@example.com",
      password: FIELDS.password,
      store: CLAIMS,
      clock: CLOCK,
      directory: ACCOUNTS,
      emailSender: SENDER,
      resetRequestUrl: "http://localhost:3000/reset-password",
      from: "3moji <no-reply@mail.3moji.me>",
    });
  });

  it("sends an accepted Claim to the hold screen, percent-encoded", async () => {
    // `encoded`, never the raw key: a raw emoji in a `Location` header fails
    // Node's own header validation with ERR_INVALID_CHAR and serves a 500.
    await submitClaimAction(form(FIELDS));

    expect(redirect).toHaveBeenCalledWith(
      `/claim/held/${ENCODED}?reason=pending`,
    );
  });

  it("never trims the password, because spaces are part of it", async () => {
    await submitClaimAction(form({ ...FIELDS, password: "  spaces matter  " }));

    expect(submitClaim).toHaveBeenCalledWith(
      expect.objectContaining({ password: "  spaces matter  " }),
    );
  });

  it("stays on the form when the Handle is taken", async () => {
    submitClaim.mockResolvedValue({ state: "taken", because: "claimed" });

    const result = await submitClaimAction(form(FIELDS));

    expect(result).toEqual({ state: "taken", because: "claimed" });
    expect(redirect).not.toHaveBeenCalled();
  });

  it("stays on the form for a Reserved Handle", async () => {
    submitClaim.mockResolvedValue({ state: "not-claimable" });

    expect(await submitClaimAction(form(FIELDS))).toEqual({
      state: "not-claimable",
    });
  });

  it("stays on the form for a segment that is not a Handle", async () => {
    submitClaim.mockResolvedValue({ state: "not-a-handle" });

    expect(await submitClaimAction(form(FIELDS))).toEqual({
      state: "not-a-handle",
    });
  });

  it.each([
    ["no handle", { email: "a@b.com", password: "12345678" }],
    ["no email", { handle: ICE, password: "12345678" }],
    ["no password", { handle: ICE, email: "a@b.com" }],
    ["a blank email", { handle: ICE, email: "  ", password: "12345678" }],
    ["a blank password", { handle: ICE, email: "a@b.com", password: "" }],
  ])("refuses %s without reaching the domain", async (_name, fields) => {
    // A server action is a public HTTP endpoint: whatever a client posts
    // arrives here, so nothing is assumed about the shape of it.
    const result = await submitClaimAction(form(fields));

    expect(result).toEqual({ state: "invalid" });
    expect(submitClaim).not.toHaveBeenCalled();
  });

  it("reports a failure rather than a rejection when the Claim throws", async () => {
    const logged = jest
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    submitClaim.mockRejectedValue(new Error("DATABASE_URL is not set"));

    const result = await submitClaimAction(form(FIELDS));

    expect(result).toEqual({ state: "failed" });
    expect(logged).toHaveBeenCalledWith(
      expect.stringContaining("claim_submit_failed"),
    );
    logged.mockRestore();
  });
});
