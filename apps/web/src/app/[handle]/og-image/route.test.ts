import type { Boundary } from "../../../lib/boundary-log";
import type { OgImageInput } from "../../../lib/og/image-input";

const ENCODED = "%F0%9F%A7%8A%F0%9F%A7%8A%F0%9F%A7%8A";

/**
 * The route is wiring and nothing more: which input a segment gets is
 * `lib/og/handle-image.test.ts`'s, and what the response is built from is
 * `lib/og/image.test.tsx`'s. Both are faked here so this suite asserts only
 * that the segment reaches the one and the answer reaches the other untouched.
 */
const mockInputFor = jest.fn((_segment: string): Promise<OgImageInput> =>
  Promise.resolve({ kind: "generic" }),
);
jest.mock("../../../lib/og/handle-image", () => ({
  ogImageInputForSegment: (segment: string) => mockInputFor(segment),
}));

const RESPONSE = { marker: "the image response" } as unknown as Response;
const mockResponseFor = jest.fn((_input: OgImageInput): Response => RESPONSE);
jest.mock("../../../lib/og/image", () => ({
  ogImageResponse: (input: OgImageInput) => mockResponseFor(input),
}));

/** The line itself is `lib/api-boundaries.test.ts`'s; here, only its name. */
const mockBoundaries: Boundary[] = [];
jest.mock("../../../lib/boundary-log", () => ({
  atBoundary: (boundary: Boundary, run: () => Promise<unknown>) => {
    mockBoundaries.push(boundary);
    return run();
  },
}));

import { GET } from "./route";

describe("GET /[handle]/og-image", () => {
  it("draws the image for the segment exactly as Next.js gave it, still encoded, at its own boundary", async () => {
    const input: OgImageInput = {
      kind: "handle",
      glyphs: ["a", "b", "c"],
      displayName: undefined,
    };
    mockInputFor.mockResolvedValue(input);

    const response = await GET({} as Request, {
      params: Promise.resolve({ handle: ENCODED }),
    });

    expect(mockInputFor).toHaveBeenCalledWith(ENCODED);
    expect(mockResponseFor).toHaveBeenCalledWith(input);
    expect(response).toBe(RESPONSE);
    expect(mockBoundaries).toEqual(["og-image.handle"]);
  });
});
