import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import { authSchema } from "../db/schema";

import { createDrizzleHandleSearchIndex } from "./drizzle-handle-search-index";

/**
 * The search index's adapter without a database (#144's rule): a statement
 * that cannot reach Postgres leaves the adapter as `DatabaseQueryFailed`,
 * carrying a code and none of the emoji it bound. What it finds is proved
 * against a real Postgres in `drizzle-handle-search-index.integration.test.ts`.
 */
const PIZZA = "\u{1F355}";

describe("createDrizzleHandleSearchIndex", () => {
  it("rejects as DatabaseQueryFailed, with no bound emoji, when the database cannot be reached", async () => {
    const closed = new Pool({
      host: "127.0.0.1",
      port: 59999,
      connectionTimeoutMillis: 2000,
    });
    const index = createDrizzleHandleSearchIndex(
      drizzle(closed, { schema: authSchema }),
    );

    let caught: unknown;
    try {
      await index.claimedKeysContaining([[PIZZA]], 5);
    } catch (error) {
      caught = error;
    } finally {
      await closed.end();
    }

    const fields =
      typeof caught === "object" && caught !== null
        ? {
            name: "name" in caught ? caught.name : undefined,
            code: "code" in caught ? caught.code : undefined,
            cause: "cause" in caught ? caught.cause : undefined,
          }
        : { name: undefined, code: undefined, cause: undefined };
    expect(fields).toEqual({
      name: "DatabaseQueryFailed",
      code: "ECONNREFUSED",
      cause: undefined,
    });
    expect(`${String(caught)} ${JSON.stringify(caught)}`).not.toContain(PIZZA);
  });

  it("asks nothing for no groups", async () => {
    const closed = new Pool({ host: "127.0.0.1", port: 59999 });
    const index = createDrizzleHandleSearchIndex(
      drizzle(closed, { schema: authSchema }),
    );

    try {
      await expect(index.claimedKeysContaining([], 5)).resolves.toEqual([]);
    } finally {
      await closed.end();
    }
  });

  it("rejects the exact read as DatabaseQueryFailed too, with no bound emoji", async () => {
    const closed = new Pool({
      host: "127.0.0.1",
      port: 59999,
      connectionTimeoutMillis: 2000,
    });
    const index = createDrizzleHandleSearchIndex(
      drizzle(closed, { schema: authSchema }),
    );

    let caught: unknown;
    try {
      await index.claimedKeysSaying([[PIZZA], [PIZZA], [PIZZA]], 5);
    } catch (error) {
      caught = error;
    } finally {
      await closed.end();
    }

    expect(
      typeof caught === "object" && caught !== null && "name" in caught
        ? caught.name
        : undefined,
    ).toBe("DatabaseQueryFailed");
    expect(`${String(caught)} ${JSON.stringify(caught)}`).not.toContain(PIZZA);
  });

  it("asks nothing for an exact read that is not three non-empty positions", async () => {
    const closed = new Pool({ host: "127.0.0.1", port: 59999 });
    const index = createDrizzleHandleSearchIndex(
      drizzle(closed, { schema: authSchema }),
    );

    try {
      await expect(
        index.claimedKeysSaying([[PIZZA], [PIZZA]], 5),
      ).resolves.toEqual([]);
      await expect(
        index.claimedKeysSaying([[PIZZA], [], [PIZZA]], 5),
      ).resolves.toEqual([]);
    } finally {
      await closed.end();
    }
  });
});
