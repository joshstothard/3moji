import { resolveDriver } from "./driver";

describe("resolveDriver", () => {
  // The point of ADR-0010. A driver chosen by NODE_ENV meant CI exercised
  // something production never ran, and four pull requests merged green over a
  // Claim path that could not open a transaction. There is now one answer.
  it.each(["production", "development", "test", undefined])(
    "answers node-postgres when NODE_ENV is %s",
    (nodeEnv) => {
      expect(resolveDriver({ nodeEnv })).toBe("node-postgres");
    },
  );

  it("gives production and test the same driver, which is the whole decision", () => {
    expect(resolveDriver({ nodeEnv: "production" })).toBe(
      resolveDriver({ nodeEnv: "test" }),
    );
  });

  it("does not read process.env itself", () => {
    const previous = process.env.NODE_ENV;
    try {
      process.env.NODE_ENV = "production";
      expect(resolveDriver({ nodeEnv: "test" })).toBe("node-postgres");
    } finally {
      if (previous === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previous;
    }
  });
});
