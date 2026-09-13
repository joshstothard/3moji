/**
 * @jest-environment node
 */

/**
 * `GET /api/viewer`: the one response in the app that differs by visitor
 * (#193).
 *
 * It exists so the pages do not have to. The navbar's island asks this route
 * who is looking, and every page — the public Profile above all — stays the
 * same bytes for everybody. So what matters here is that the per-visitor answer
 * is never stored anywhere shared, and that it carries only what the island
 * renders. The boundary line itself is `lib/api-boundaries.test.ts`'s.
 */
import type { Boundary } from "../../../lib/boundary-log";

const ICE = "\u{1F9CA}\u{1F9CA}\u{1F9CA}";
const ENCODED = "%F0%9F%A7%8A%F0%9F%A7%8A%F0%9F%A7%8A";

const readViewerSummary = jest.fn((): Promise<unknown> =>
  Promise.resolve({ state: "owner", key: ICE, encoded: ENCODED }),
);
jest.mock("../../../lib/viewer", () => ({
  readViewerSummary: () => readViewerSummary(),
}));

const mockBoundaries: Boundary[] = [];
jest.mock("../../../lib/boundary-log", () => ({
  atBoundary: (boundary: Boundary, run: () => Promise<unknown>) => {
    mockBoundaries.push(boundary);
    return run();
  },
}));

import { GET } from "./route";

beforeEach(() => {
  mockBoundaries.length = 0;
  readViewerSummary.mockResolvedValue({
    state: "owner",
    key: ICE,
    encoded: ENCODED,
  });
});

describe("GET /api/viewer", () => {
  it("answers the summary as JSON, at its own boundary", async () => {
    const response = await GET();

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toMatch(/^application\/json/);
    expect(await response.json()).toEqual({
      state: "owner",
      key: ICE,
      encoded: ENCODED,
    });
    expect(mockBoundaries).toEqual(["viewer.read"]);
  });

  it("is never stored by a shared cache, nor reused for another visitor", async () => {
    const response = await GET();

    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("vary")).toBe("Cookie");
  });

  it("answers signed-out the same way, headers included", async () => {
    readViewerSummary.mockResolvedValue({ state: "signed-out" });

    const response = await GET();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.json()).toEqual({ state: "signed-out" });
  });
});
