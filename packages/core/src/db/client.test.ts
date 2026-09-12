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
    expect(createDatabase({ url: URL, nodeEnv: "production" }).driver).toBe(
      "neon-http",
    );
  });

  it("honours an explicit driver override", async () => {
    const handle = createDatabase({
      url: URL,
      nodeEnv: "production",
      driver: "node-postgres",
    });
    expect(handle.driver).toBe("node-postgres");
    await handle.close();
  });

  it("closing a neon handle is a no-op rather than an error", async () => {
    const handle = createDatabase({ url: URL, driver: "neon-http" });
    await expect(handle.close()).resolves.toBeUndefined();
  });

  it("does not connect when constructed", () => {
    // Both drivers are lazy. If either connected eagerly this would reject
    // against a database that is not running locally.
    expect(() => createDatabase({ url: URL, nodeEnv: "test" })).not.toThrow();
  });
});
