import {
  authSchema,
  createCoreServices,
  createDatabase,
  createSystemClock,
  resolveDriver,
} from "./index";
import type { Clock, CoreDependencies, CoreServices } from "./index";

describe("package entry point", () => {
  it("exports the composition root", () => {
    expect(typeof createCoreServices).toBe("function");
  });

  it("exports the system clock adapter", () => {
    expect(typeof createSystemClock).toBe("function");
  });

  it("exports the database factory and driver resolver", () => {
    expect(typeof createDatabase).toBe("function");
    expect(typeof resolveDriver).toBe("function");
  });

  it("exports the auth schema keyed the way Better Auth expects", () => {
    expect(Object.keys(authSchema).sort()).toEqual([
      "account",
      "session",
      "user",
      "verification",
    ]);
  });

  it("builds a database handle through the public API alone", async () => {
    const handle = createDatabase({
      url: "postgresql://app:app@localhost:5432/app_test",
      nodeEnv: "test",
    });
    expect(handle.driver).toBe("node-postgres");
    await handle.close();
  });

  it("wires a usable domain surface through the public API alone", () => {
    const clock: Clock = { now: () => new Date("2026-09-12T00:00:00.000Z") };
    const deps: CoreDependencies = { clock };
    const services: CoreServices = createCoreServices(deps);

    expect(services.clock.now().toISOString()).toBe("2026-09-12T00:00:00.000Z");
  });
});
