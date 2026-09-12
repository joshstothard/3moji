import { resolveDriver, type DatabaseDriver } from "./driver";

describe("resolveDriver", () => {
  it("uses Neon's serverless HTTP driver in production", () => {
    expect(resolveDriver({ nodeEnv: "production" })).toBe("neon-http");
  });

  it.each(["development", "test", undefined])(
    "uses node-postgres when NODE_ENV is %s",
    (nodeEnv) => {
      expect(resolveDriver({ nodeEnv })).toBe("node-postgres");
    },
  );

  it("lets an explicit override win over NODE_ENV", () => {
    expect(
      resolveDriver({ nodeEnv: "production", override: "node-postgres" }),
    ).toBe("node-postgres");
    expect(resolveDriver({ nodeEnv: "test", override: "neon-http" })).toBe(
      "neon-http",
    );
  });

  it("rejects an override it does not recognise, naming the value", () => {
    expect(() =>
      resolveDriver({ nodeEnv: "test", override: "sqlite" as DatabaseDriver }),
    ).toThrow(/sqlite/);
  });

  it("does not read process.env itself", () => {
    const previous = process.env.NODE_ENV;
    try {
      process.env.NODE_ENV = "production";
      // The caller passes the environment in; nothing is read ambiently, so a
      // production process.env must not change a test-env decision.
      expect(resolveDriver({ nodeEnv: "test" })).toBe("node-postgres");
    } finally {
      if (previous === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previous;
    }
  });
});
