/**
 * @jest-environment node
 */

/**
 * The server action behind the builder's availability line.
 *
 * Its remit is narrow, and narrower than it was: the read itself, and how it
 * degrades when the database is out of reach, moved to `lib/availability.ts`
 * when `/[handle]` came to need the same answer about the same segment
 * ([#80](https://github.com/joshstothard/3moji/issues/80)) — and is asserted
 * there, in `lib/availability.test.ts`. What is left here is the boundary an
 * action alone owns: a public HTTP endpoint accepts whatever a client sends.
 */
import type { AvailabilityState } from "./availability-state";

const readAvailability = jest.fn(
  (_segment: string): Promise<AvailabilityState> =>
    Promise.resolve("available"),
);
jest.mock("../lib/availability", () => ({
  readAvailability: (segment: string) => readAvailability(segment),
}));

import { checkAvailability } from "./availability-action";

const ENCODED = "%F0%9F%A7%8A%F0%9F%A7%8A%F0%9F%A7%8A";

describe("the availability action", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    readAvailability.mockResolvedValue("available");
  });

  it("hands the segment to the one shared read, untouched", async () => {
    await checkAvailability(ENCODED);

    expect(readAvailability).toHaveBeenCalledWith(ENCODED);
  });

  it.each([
    "available",
    "held",
    "claimed",
    "not-claimable",
    "not-a-handle",
    "unknown",
  ] as const)("passes the %s answer straight back", async (state) => {
    readAvailability.mockResolvedValue(state);

    await expect(checkAvailability(ENCODED)).resolves.toBe(state);
  });

  it("answers unknown for input that is not a string, because a client sends what it likes", async () => {
    await expect(checkAvailability(42)).resolves.toBe("unknown");

    expect(readAvailability).not.toHaveBeenCalled();
  });

  it("answers a state name and nothing else, so no hold expiry can ride along", async () => {
    // ADR-0004: a countdown is an information leak. `AvailabilityState` is a
    // string union, so the wire format has nowhere to put one — this pins that
    // the action returns the union rather than the domain's richer result.
    readAvailability.mockResolvedValue("held");

    const answer = await checkAvailability(ENCODED);

    expect(typeof answer).toBe("string");
    expect(answer).toBe("held");
  });
});
