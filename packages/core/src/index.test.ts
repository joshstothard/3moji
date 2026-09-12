import { createCoreServices, createSystemClock } from "./index";
import type { Clock, CoreDependencies, CoreServices } from "./index";

describe("package entry point", () => {
  it("exports the composition root", () => {
    expect(typeof createCoreServices).toBe("function");
  });

  it("exports the system clock adapter", () => {
    expect(typeof createSystemClock).toBe("function");
  });

  it("wires a usable domain surface through the public API alone", () => {
    const clock: Clock = { now: () => new Date("2026-09-12T00:00:00.000Z") };
    const deps: CoreDependencies = { clock };
    const services: CoreServices = createCoreServices(deps);

    expect(services.clock.now().toISOString()).toBe("2026-09-12T00:00:00.000Z");
  });
});
