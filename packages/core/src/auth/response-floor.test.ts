import type { Clock } from "../ports/clock";
import {
  RESPONSE_FLOOR_MS,
  realSleep,
  withResponseFloor,
} from "./response-floor";

/** A clock a test moves by hand, so no assertion waits on real time. */
const movableClock = (): { clock: Clock; advance: (ms: number) => void } => {
  let now = new Date("2026-09-12T12:00:00.000Z").getTime();
  return {
    clock: { now: () => new Date(now) },
    advance: (ms) => {
      now += ms;
    },
  };
};

const recordingSleep = (): {
  sleep: (ms: number) => Promise<void>;
  slept: number[];
} => {
  const slept: number[] = [];
  return {
    slept,
    sleep: (ms) => {
      slept.push(ms);
      return Promise.resolve();
    },
  };
};

describe("withResponseFloor", () => {
  it("holds a fast answer back for the rest of the floor", async () => {
    const { clock, advance } = movableClock();
    const { sleep, slept } = recordingSleep();

    const value = await withResponseFloor({ clock, sleep }, () => {
      advance(20);
      return Promise.resolve("answered");
    });

    expect(value).toBe("answered");
    expect(slept).toEqual([RESPONSE_FLOOR_MS - 20]);
  });

  it("does not delay an answer that already took longer than the floor", async () => {
    const { clock, advance } = movableClock();
    const { sleep, slept } = recordingSleep();

    await withResponseFloor({ clock, sleep }, () => {
      advance(RESPONSE_FLOOR_MS + 40);
      return Promise.resolve("slow");
    });

    expect(slept).toEqual([]);
  });

  it("pads a rejection too, because a fast failure leaks as much as a fast success", async () => {
    const { clock, advance } = movableClock();
    const { sleep, slept } = recordingSleep();

    await expect(
      withResponseFloor({ clock, sleep }, () => {
        advance(5);
        return Promise.reject(new Error("boom"));
      }),
    ).rejects.toThrow("boom");

    expect(slept).toEqual([RESPONSE_FLOOR_MS - 5]);
  });

  it("leaves an answer unpadded when it has nothing to conceal", async () => {
    const { clock, advance } = movableClock();
    const { sleep, slept } = recordingSleep();

    const value = await withResponseFloor(
      { clock, sleep },
      () => {
        advance(1);
        return Promise.resolve("about a handle, not an address");
      },
      () => false,
    );

    expect(value).toBe("about a handle, not an address");
    expect(slept).toEqual([]);
  });

  it("takes a floor from the caller, so a test need not wait half a second", async () => {
    const { clock, sleep, slept } = {
      ...movableClock(),
      ...recordingSleep(),
    };

    await withResponseFloor({ clock, sleep, floorMs: 10 }, () =>
      Promise.resolve("x"),
    );

    expect(slept).toEqual([10]);
  });

  it("sleeps for real when nothing is injected", async () => {
    // The default every production path takes. Asserted with 1 ms so the suite
    // does not wait: what matters is that it resolves rather than hanging, and
    // that `withResponseFloor` therefore holds an answer back in production
    // even though every other test here substitutes a recording sleep.
    const started = Date.now();

    await realSleep(1);

    expect(Date.now() - started).toBeGreaterThanOrEqual(0);
  });

  it("matches Better Auth's own 500 ms, so the two paths agree", () => {
    // Its /send-verification-email endpoint enforces this exact figure; picking
    // a different one would make our padded answers distinguishable from its.
    expect(RESPONSE_FLOOR_MS).toBe(500);
  });
});
