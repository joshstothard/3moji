/**
 * @jest-environment node
 */

/**
 * `GET /api/search?q=`: the header search's route
 * ([ADR-0012](../../../../../../docs/adr/0012-header-search-lists-claimed-handles-with-display-names-capped-and-rate-limited.md),
 * [#254](https://github.com/joshstothard/3moji/issues/254)).
 *
 * A thin adapter: the rules are `searchHandles`'s and the limit is
 * `searchClientRateLimiter`'s, both in `packages/core`. What this suite pins
 * is the transport's part of decisions 6 and 7 — every request is counted
 * before the query is read, a refusal is a plain `429` with no retry hint, and
 * no answer is ever stored by a shared cache. That the boundary line carries
 * no query text is `lib/api-boundaries.test.ts`'s.
 */
import type { Boundary, BoundaryOutcome } from "../../../lib/boundary-log";

const ICE = "\u{1F9CA}\u{1F9CA}\u{1F9CA}";
const IP = "198.51.100.73";

const SEARCH = {
  handles: [
    {
      key: ICE,
      encoded: encodeURIComponent(ICE),
      alias: "ice-cube.ice-cube.ice-cube",
      displayName: "Ada",
    },
  ],
  emoji: [{ emoji: "\u{1F9CA}", name: "ice cube" }],
};

const searchHandles = jest.fn((_input: unknown): Promise<unknown> =>
  Promise.resolve(SEARCH),
);
jest.mock("@template/core", () => ({
  searchHandles: (input: unknown): Promise<unknown> => searchHandles(input),
}));

const admit = jest.fn(
  (_address: string | undefined): Promise<{ state: string }> =>
    Promise.resolve({ state: "admitted" }),
);
const handleSearch = { claimedKeysContaining: jest.fn() };
const profiles = { profileOf: jest.fn(), displayNamesOf: jest.fn() };
const getServices = jest.fn((): unknown => ({
  searchClientRateLimiter: { admit },
  handleSearch,
  profiles,
}));
jest.mock("../../../lib/services", () => ({
  getServices: (): unknown => getServices(),
}));

const logFailure = jest.fn();
jest.mock("../../../lib/log-error", () => ({
  logFailure: (event: string, error: unknown): void => {
    logFailure(event, error);
  },
}));

const mockBoundaries: { boundary: Boundary; outcome: BoundaryOutcome }[] = [];
jest.mock("../../../lib/boundary-log", () => ({
  atBoundary: async (
    boundary: Boundary,
    run: (record: (outcome: BoundaryOutcome) => void) => Promise<unknown>,
  ) => {
    let outcome: BoundaryOutcome = "ok";
    const value = await run((recorded) => {
      outcome = recorded;
    });
    mockBoundaries.push({ boundary, outcome });
    return value;
  },
}));

import { GET } from "./route";

function searchRequest(query: string | undefined): Request {
  const url =
    query === undefined
      ? "http://localhost:3000/api/search"
      : `http://localhost:3000/api/search?q=${encodeURIComponent(query)}`;
  return new Request(url, {
    headers: { "x-vercel-forwarded-for": IP, "x-forwarded-for": IP },
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockBoundaries.length = 0;
  admit.mockResolvedValue({ state: "admitted" });
  searchHandles.mockResolvedValue(SEARCH);
});

describe("GET /api/search", () => {
  it("answers the search as JSON at its own boundary, from the services' index and Profiles", async () => {
    const response = await GET(searchRequest("ice-cube"));

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toMatch(/^application\/json/);
    expect(await response.json()).toEqual(SEARCH);
    expect(searchHandles).toHaveBeenCalledWith({
      query: "ice-cube",
      index: handleSearch,
      profiles,
    });
    expect(mockBoundaries).toEqual([
      { boundary: "search.read", outcome: "ok" },
    ]);
  });

  it("is never stored by a shared cache (decision 7)", async () => {
    const response = await GET(searchRequest("ice-cube"));

    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });

  it("counts every request against the client address, before and whatever the query", async () => {
    await GET(searchRequest(undefined));

    expect(admit.mock.calls).toEqual([[IP]]);
    expect(searchHandles).toHaveBeenCalledWith(
      expect.objectContaining({ query: "" }),
    );
  });

  it("refuses a request over the limit with a plain 429, no retry hint and no search (decision 6)", async () => {
    admit.mockResolvedValue({ state: "rate-limited" });

    const response = await GET(searchRequest("ice-cube"));

    expect(response.status).toBe(429);
    expect(await response.text()).toBe("");
    expect(response.headers.get("retry-after")).toBeNull();
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(searchHandles).not.toHaveBeenCalled();
    expect(mockBoundaries).toEqual([
      { boundary: "search.read", outcome: "rate-limited" },
    ]);
  });

  it("answers a failure without a body, logged through logFailure, and fails closed when the limiter cannot count", async () => {
    admit.mockRejectedValue(new Error("database unreachable"));

    const response = await GET(searchRequest("ice-cube"));

    expect(response.status).toBe(500);
    expect(await response.text()).toBe("");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(searchHandles).not.toHaveBeenCalled();
    expect(logFailure).toHaveBeenCalledWith("search_failed", expect.any(Error));
    expect(mockBoundaries).toEqual([
      { boundary: "search.read", outcome: "failed" },
    ]);
  });
});
