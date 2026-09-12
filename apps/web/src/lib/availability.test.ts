/**
 * @jest-environment node
 */

/**
 * The one availability read, and what it answers when the database is out of
 * reach.
 *
 * `@template/core` is mocked because its root entry point cannot be `require`d
 * under this suite (better-auth is ESM-only), and it is the right boundary
 * anyway: what belongs here is which dependencies the read hands the domain and
 * which answer survives a failure. That 🍕🍕🍕 is Reserved and 🔪🔪🔪 carries a
 * blocked emoji is the domain's own assertion, made in
 * `packages/core/src/handle/claimable.test.ts` and again end to end in
 * `apps/web/e2e/handle-url.spec.ts`.
 */
interface AvailabilityInput {
  readonly segment: unknown;
  readonly repository: unknown;
  readonly clock: unknown;
}

type Claimability =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: "not-a-handle" | "reserved" };

const CLOCK = { now: () => new Date(0) };
const REPOSITORY = { availabilityOf: jest.fn() };

/** The domain's answer, as much of it as this boundary reads: the state name,
 * plus whatever else the real result carries beside it. */
interface DomainAnswer {
  readonly state: string;
  readonly handle?: unknown;
}

const handleAvailability = jest.fn(
  (_input: AvailabilityInput): Promise<DomainAnswer> =>
    Promise.resolve({ state: "available" }),
);
const claimableHandle = jest.fn((_segment: string): Claimability => ({
  ok: true,
}));
jest.mock("@template/core", () => ({
  handleAvailability: (input: AvailabilityInput) => handleAvailability(input),
  claimableHandle: (segment: string) => claimableHandle(segment),
}));

const getServices = jest.fn(() => ({
  clock: CLOCK,
  handles: REPOSITORY,
  auth: {},
}));
jest.mock("./services", () => ({
  getServices: () => getServices(),
}));

import { readAvailability } from "./availability";

const ENCODED = "%F0%9F%A7%8A%F0%9F%A7%8A%F0%9F%A7%8A";

/** What reached `console.error`, captured typed rather than read off the mock's
 * `any[][]` call log. */
const logged: unknown[] = [];

/** Make the database unreachable, as it is on a clone with no environment. */
function unconfigured(): void {
  getServices.mockImplementation(() => {
    throw new Error("DATABASE_URL is not set.");
  });
}

describe("the availability read", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    handleAvailability.mockResolvedValue({ state: "available" });
    claimableHandle.mockReturnValue({ ok: true });
    getServices.mockReturnValue({
      clock: CLOCK,
      handles: REPOSITORY,
      auth: {},
    });
    logged.length = 0;
    jest.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      logged.push(args[0]);
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("hands the domain the segment, the repository and the one clock", async () => {
    await readAvailability(ENCODED);

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

      await expect(readAvailability(ENCODED)).resolves.toBe(state);
    },
  );

  it("still answers not-claimable for a Reserved Handle with no database at all", async () => {
    // This is the whole of issue #68: `claimableHandle` is pure, so "nobody may
    // ever own this" is answerable at zero I/O cost. Degrading it to "we could
    // not check" would put the original lie back on a clone with no
    // environment — which is every fresh clone, and CI's E2E job.
    unconfigured();
    claimableHandle.mockReturnValue({ ok: false, reason: "reserved" });

    await expect(readAvailability(ENCODED)).resolves.toBe("not-claimable");
  });

  it("answers not-a-handle from the pure gate when the database is unreachable", async () => {
    unconfigured();
    claimableHandle.mockReturnValue({ ok: false, reason: "not-a-handle" });

    await expect(readAvailability("abc")).resolves.toBe("not-a-handle");
  });

  it("answers unknown for a Handle whose owner only the database knows", async () => {
    // available, held and claimed are indistinguishable without the table, and
    // guessing "available" is exactly the lie #68 is about.
    unconfigured();

    await expect(readAvailability(ENCODED)).resolves.toBe("unknown");
  });

  it("degrades the same way when the read itself fails, not only the wiring", async () => {
    handleAvailability.mockRejectedValue(new Error("connection refused"));
    claimableHandle.mockReturnValue({ ok: false, reason: "reserved" });

    await expect(readAvailability(ENCODED)).resolves.toBe("not-claimable");
  });

  it("logs the failure as one structured line rather than swallowing it", async () => {
    unconfigured();

    await readAvailability(ENCODED);

    const [line] = logged;
    expect(typeof line).toBe("string");
    expect(JSON.parse(String(line))).toMatchObject({
      event: "availability_check_failed",
      message: "DATABASE_URL is not set.",
    });
  });

  it("never leaks a hold expiry or a holder: the answer is one state name", async () => {
    // The transport type is `HandleAvailability["state"] | "unknown"`, a string
    // union, so there is no field a countdown could travel in. ADR-0004 treats
    // one as an information leak; this asserts the shape that makes it
    // impossible rather than the absence of a render.
    handleAvailability.mockResolvedValue({
      state: "held",
      handle: { key: "held" },
    });

    const answer = await readAvailability(ENCODED);

    expect(typeof answer).toBe("string");
    expect(answer).toBe("held");
  });
});
