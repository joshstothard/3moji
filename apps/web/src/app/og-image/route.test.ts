import type { Boundary } from "../../lib/boundary-log";
import { GENERIC_IMAGE, type OgImageInput } from "../../lib/og/image-input";

const RESPONSE = { marker: "the generic image" } as unknown as Response;
const mockResponseFor = jest.fn((_input: OgImageInput): Response => RESPONSE);
jest.mock("../../lib/og/image", () => ({
  ogImageResponse: (input: OgImageInput) => mockResponseFor(input),
}));

/**
 * The boundary line itself is `lib/api-boundaries.test.ts`'s, run inside a
 * real request store. What belongs here is that this route answers through
 * one, under its own name.
 */
const mockBoundaries: Boundary[] = [];
jest.mock("../../lib/boundary-log", () => ({
  atBoundary: (boundary: Boundary, run: () => Promise<unknown>) => {
    mockBoundaries.push(boundary);
    return run();
  },
}));

import { GET } from "./route";

describe("GET /og-image", () => {
  it("draws exactly the generic image every non-claimed Handle gets, at its own boundary", async () => {
    await expect(GET()).resolves.toBe(RESPONSE);

    expect(mockResponseFor).toHaveBeenCalledWith(GENERIC_IMAGE);
    expect(mockBoundaries).toEqual(["og-image.generic"]);
  });
});
