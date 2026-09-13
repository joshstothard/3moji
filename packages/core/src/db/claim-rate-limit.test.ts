import { getTableName } from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/pg-core";

import { claimRateLimit } from "./claim-rate-limit";

const config = getTableConfig(claimRateLimit);
const columnNames = config.columns.map((column) => column.name);

describe("the claim_rate_limit table", () => {
  it("is called claim_rate_limit", () => {
    expect(getTableName(claimRateLimit)).toBe("claim_rate_limit");
  });

  it("holds a bucket hash, a window and a count, and nothing that names a person", () => {
    // An email or client address column here would make the table a record of
    // who tried to claim. The bucket is a keyed hash (#157).
    expect(columnNames).toEqual(["bucket", "window_start", "count"]);
  });

  it("has no link to an Account, because it counts submissions rather than Accounts", () => {
    expect(config.foreignKeys).toEqual([]);
  });

  it("is keyed on bucket and window, which is the atomic increment's conflict target", () => {
    expect(config.primaryKeys).toHaveLength(1);
    expect(config.primaryKeys[0]?.columns.map((column) => column.name)).toEqual(
      ["bucket", "window_start"],
    );
  });

  it("indexes the window, which is what forgetting ended windows scans", () => {
    expect(
      config.indexes.map((index) => ({
        name: index.config.name,
        columns: index.config.columns.map((column) =>
          "name" in column ? column.name : "expression",
        ),
      })),
    ).toEqual([
      { name: "claim_rate_limit_window_start_idx", columns: ["window_start"] },
    ]);
  });

  it("takes the window from the caller's clock, never a SQL default", () => {
    const windowStart = config.columns.find(
      (column) => column.name === "window_start",
    );
    expect(windowStart?.hasDefault).toBe(false);
    expect(windowStart?.notNull).toBe(true);
  });
});
