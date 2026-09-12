import { createCoreServices } from "./composition-root";
import type { Clock } from "./ports/clock";

const fixedClock = (at: string): Clock => ({ now: () => new Date(at) });

describe("createCoreServices", () => {
  it("exposes the clock it was given", () => {
    const clock = fixedClock("2026-09-12T10:00:00.000Z");
    const services = createCoreServices({ clock });

    expect(services.clock.now().toISOString()).toBe("2026-09-12T10:00:00.000Z");
  });

  it("reads time through the injected clock rather than the system clock", () => {
    const services = createCoreServices({
      clock: fixedClock("1999-12-31T23:59:59.000Z"),
    });

    expect(services.clock.now().getFullYear()).toBe(1999);
  });
});
