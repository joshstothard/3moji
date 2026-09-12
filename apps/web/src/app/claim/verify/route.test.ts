/**
 * @jest-environment node
 */

/**
 * The verification landing.
 *
 * `@template/core` is mocked because its root entry point is ESM-only under
 * this suite, and it is the right boundary anyway: `finaliseClaim` decides what
 * happened, and this route decides where that sends somebody and which headers
 * travel with them. **The cookie forwarding is the assertion that matters** —
 * it is the sign-in, and dropping it would verify an address and sign nobody
 * in, silently.
 */
const ICE = "\u{1F9CA}\u{1F9CA}\u{1F9CA}";
const ENCODED = "%F0%9F%A7%8A%F0%9F%A7%8A%F0%9F%A7%8A";

interface FinaliseInput {
  readonly token: string;
  readonly dispatches: unknown;
  readonly directory: unknown;
  readonly finaliser: unknown;
  readonly clock: unknown;
}

type Finalisation =
  | {
      readonly state: "claimed";
      readonly key: string;
      readonly headers: Headers;
    }
  | { readonly state: "already-claimed"; readonly key: string }
  | { readonly state: "link-superseded"; readonly key: string }
  | { readonly state: "link-expired"; readonly key: string }
  | { readonly state: "hold-expired"; readonly key: string }
  | { readonly state: "link-unknown" };

const finaliseClaim = jest.fn((_input: FinaliseInput): Promise<Finalisation> =>
  Promise.resolve({
    state: "claimed",
    key: ICE,
    headers: new Headers({ "set-cookie": "session=abc; Path=/; HttpOnly" }),
  }),
);
jest.mock("@template/core", () => ({
  finaliseClaim: (input: FinaliseInput) => finaliseClaim(input),
}));

const CLOCK = { now: () => new Date(0) };
const DISPATCHES = { findByTokenHash: jest.fn() };
const ACCOUNTS = { byEmail: jest.fn(), handleOf: jest.fn() };
const FINALISER = { runInTransaction: jest.fn() };

const getServices = jest.fn(() => ({
  clock: CLOCK,
  dispatches: DISPATCHES,
  accounts: ACCOUNTS,
  claimFinaliser: FINALISER,
}));
jest.mock("../../../lib/services", () => ({
  getServices: () => getServices(),
}));

import { GET } from "./route";

const follow = (query = "?token=a.real.token"): Promise<Response> =>
  GET(new Request(`http://localhost:3000/claim/verify${query}`));

describe("the verification landing", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    finaliseClaim.mockResolvedValue({
      state: "claimed",
      key: ICE,
      headers: new Headers({ "set-cookie": "session=abc; Path=/; HttpOnly" }),
    });
  });

  it("hands the use case the token and the wired collaborators", async () => {
    await follow();

    expect(finaliseClaim).toHaveBeenCalledWith({
      token: "a.real.token",
      dispatches: DISPATCHES,
      directory: ACCOUNTS,
      finaliser: FINALISER,
      clock: CLOCK,
    });
  });

  it("forwards the session cookie, which is what signs them in", async () => {
    const response = await follow();

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(`/claim/verified/${ENCODED}`);
    expect(response.headers.get("set-cookie")).toContain("session=abc");
  });

  it("forwards every cookie when Better Auth sets more than one", async () => {
    // `get("set-cookie")` folds them into one comma-joined string no browser
    // will parse back into two, which is why the route uses `getSetCookie()`.
    const headers = new Headers();
    headers.append("set-cookie", "session=abc; Path=/");
    headers.append("set-cookie", "session_data=xyz; Path=/");
    finaliseClaim.mockResolvedValue({ state: "claimed", key: ICE, headers });

    const response = await follow();

    expect(response.headers.getSetCookie()).toEqual([
      "session=abc; Path=/",
      "session_data=xyz; Path=/",
    ]);
  });

  it("never lets the token be cached by anything in between", async () => {
    const response = await follow();

    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("puts no raw emoji in the Location header", async () => {
    // A raw emoji there fails Node's own header validation with
    // ERR_INVALID_CHAR and serves a 500 — the lesson `/[handle]` learned.
    const response = await follow();

    expect(response.headers.get("location")).not.toContain(ICE);
  });

  it.each([
    ["already-claimed", `/claim/verified/${ENCODED}`],
    ["link-superseded", `/claim/held/${ENCODED}?reason=link-superseded`],
    ["link-expired", `/claim/held/${ENCODED}?reason=link-expired`],
    ["hold-expired", `/claim/held/${ENCODED}?reason=hold-expired`],
  ] as const)(
    "sends %s to the page that explains it",
    async (state, location) => {
      finaliseClaim.mockResolvedValue({ state, key: ICE });

      const response = await follow();

      expect(response.headers.get("location")).toBe(location);
      // Nothing but `claimed` carries a session.
      expect(response.headers.get("set-cookie")).toBeNull();
    },
  );

  it("sends a link it has no record of to the screen that names no Handle", async () => {
    finaliseClaim.mockResolvedValue({ state: "link-unknown" });

    const response = await follow();

    expect(response.headers.get("location")).toBe(
      "/claim/held?reason=link-unknown",
    );
  });

  it("treats a missing token as a link it has no record of", async () => {
    finaliseClaim.mockResolvedValue({ state: "link-unknown" });

    await follow("");

    expect(finaliseClaim).toHaveBeenCalledWith(
      expect.objectContaining({ token: "" }),
    );
  });

  it("never renders an error page for a state that still holds the Handle", async () => {
    // Five of the six states leave the Handle held, and none of them is a 4xx.
    for (const state of [
      "already-claimed",
      "link-superseded",
      "link-expired",
    ] as const) {
      finaliseClaim.mockResolvedValue({ state, key: ICE });
      const response = await follow();
      expect(response.status).toBe(303);
    }
  });

  it("lets an outage be a 500 rather than calling it an expired link", async () => {
    // "That link expired" and "the database is down" look identical to a
    // visitor and are opposite in meaning. Saying the wrong one sends somebody
    // round a resend loop that cannot end.
    finaliseClaim.mockRejectedValue(new Error("connect ECONNREFUSED"));

    await expect(follow()).rejects.toThrow(/ECONNREFUSED/);
  });

  it("resolves services per request rather than at module scope", () => {
    // `next build` imports route handlers, and the factories throw on a missing
    // secret, so eager construction would fail the build in CI.
    expect(getServices).not.toHaveBeenCalled();
  });
});
