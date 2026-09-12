import { createDatabase } from "./client";

const URL = "postgresql://app:app@localhost:5432/app_test";

describe("createDatabase", () => {
  it("refuses an empty connection string rather than failing later", () => {
    expect(() => createDatabase({ url: "", nodeEnv: "test" })).toThrow(
      /connection string/i,
    );
  });

  it("returns a handle that can be closed", async () => {
    const handle = createDatabase({ url: URL, nodeEnv: "test" });
    expect(handle.db).toBeDefined();
    expect(typeof handle.close).toBe("function");
    await expect(handle.close()).resolves.toBeUndefined();
  });

  it("reports which driver it built", () => {
    expect(createDatabase({ url: URL, nodeEnv: "test" }).driver).toBe(
      "node-postgres",
    );
    // The decision of ADR-0010, asserted where it would otherwise be assumed:
    // production gets the same driver as everything else. This test is the
    // regression guard for the divergence that let four green PRs merge over a
    // Claim path that could not open a transaction.
    expect(createDatabase({ url: URL, nodeEnv: "production" }).driver).toBe(
      "node-postgres",
    );
  });

  it("closes cleanly, because the driver holds a pool", async () => {
    const handle = createDatabase({ url: URL });
    await expect(handle.close()).resolves.toBeUndefined();
  });

  it("does not connect when constructed", () => {
    // The driver is lazy. If it connected eagerly this would reject against a
    // database that is not running locally.
    expect(() => createDatabase({ url: URL, nodeEnv: "test" })).not.toThrow();
  });
});
