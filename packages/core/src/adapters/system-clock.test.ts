import { createSystemClock } from "./system-clock";

describe("createSystemClock", () => {
  it("reports the current time", () => {
    const before = Date.now();
    const observed = createSystemClock().now().getTime();
    const after = Date.now();

    expect(observed).toBeGreaterThanOrEqual(before);
    expect(observed).toBeLessThanOrEqual(after);
  });

  it("reports a fresh time on each call", () => {
    const clock = createSystemClock();
    const first = clock.now().getTime();
    jest.useFakeTimers().setSystemTime(new Date(first + 60_000));
    try {
      expect(clock.now().getTime()).toBe(first + 60_000);
    } finally {
      jest.useRealTimers();
    }
  });
});
