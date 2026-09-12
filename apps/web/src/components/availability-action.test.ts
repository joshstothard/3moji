/**
 * @jest-environment node
 */

/**
 * The server action behind the builder's availability line.
 *
 * `@template/core` is mocked because its root entry point cannot be `require`d
 * under this suite (better-auth is ESM-only), and it is the right boundary
 * anyway: the action is a transport adapter, so what belongs here is which
 * dependencies it hands the domain and what it does when the read fails.
 */
interface AvailabilityInput {
  readonly segment: unknown;
  readonly repository: unknown;
  readonly clock: unknown;
}

const CLOCK = { now: () => new Date(0) };
const REPOSITORY = { availabilityOf: jest.fn() };

const handleAvailability = jest.fn(
  (_input: AvailabilityInput): Promise<{ readonly state: string }> =>
    Promise.resolve({ state: "available" }),
);
jest.mock("@template/core", () => ({
  handleAvailability: (input: AvailabilityInput) => handleAvailability(input),
}));

const getServices = jest.fn(() => ({
  clock: CLOCK,
  handles: REPOSITORY,
  auth: {},
}));
jest.mock("../lib/services", () => ({
  getServices: () => getServices(),
}));

import { checkAvailability } from "./availability-action";

const ENCODED = "%F0%9F%A7%8A%F0%9F%A7%8A%F0%9F%A7%8A";

describe("the availability action", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    handleAvailability.mockResolvedValue({ state: "available" });
    getServices.mockReturnValue({
      clock: CLOCK,
      handles: REPOSITORY,
      auth: {},
    });
  });

  it("hands the domain the segment, the repository and the one clock", async () => {
    await checkAvailability(ENCODED);

    expect(handleAvailability).toHaveBeenCalledWith({
      segment: ENCODED,
      repository: REPOSITORY,
      clock: CLOCK,
    });
  });

  it.each(["available", "held", "claimed", "not-claimable", "not-a-handle"])(
    "passes the %s answer straight back",
    async (state) => {
      handleAvailability.mockResolvedValue({ state });

      await expect(checkAvailability(ENCODED)).resolves.toBe(state);
    },
  );

  it("answers unknown for input that is not a string, because a client sends what it likes", async () => {
    await expect(checkAvailability(42)).resolves.toBe("unknown");

    expect(handleAvailability).not.toHaveBeenCalled();
  });

  it("answers unknown when the environment is not configured, rather than throwing into the page", async () => {
    // `lib/services.ts` throws on any of five missing variables, and a fresh
    // clone has none of them. An unhandled rejection here would take the home
    // page down for a visitor who only wanted to try the builder.
    getServices.mockImplementation(() => {
      throw new Error("DATABASE_URL is not set.");
    });

    await expect(checkAvailability(ENCODED)).resolves.toBe("unknown");
  });

  it("answers unknown when the read itself fails", async () => {
    handleAvailability.mockRejectedValue(new Error("connection refused"));

    await expect(checkAvailability(ENCODED)).resolves.toBe("unknown");
  });
});
