import { sql } from "drizzle-orm";

import { createDatabase } from "./client";

const url = process.env.DATABASE_URL;

// Fail loudly rather than skipping silently in CI: a green run that tested
// nothing is worse than a red one.
if (url === undefined && process.env.CI !== undefined) {
  throw new Error(
    "DATABASE_URL is not set. CI's integration-tests job must provide a Postgres service.",
  );
}

const describeWithDatabase = url === undefined ? describe.skip : describe;

/**
 * The connection string, narrowed.
 *
 * A guard clause rather than a non-null assertion: the package's lint rules
 * forbid `!`, and this states the requirement by name instead of asserting it
 * away. Unreachable while the suite is skipped without `DATABASE_URL`.
 */
function connectionString(): string {
  if (url === undefined) {
    throw new Error("DATABASE_URL is required for this suite");
  }
  return url;
}

/**
 * **[ADR-0010](../../../../docs/adr/0010-use-one-postgres-driver-in-every-environment.md)
 * decision 5.** The configured driver must be able to open an interactive
 * transaction.
 *
 * This test exists because nothing asserted it anywhere, and that is the whole
 * defect of [#89](https://github.com/joshstothard/3moji/issues/89). The
 * production driver was chosen by `NODE_ENV` and threw "No transactions
 * support in neon-http driver", while every test ran against a different
 * driver that worked — so four pull requests merged green over a Claim path
 * that could not have run on the deployed site.
 *
 * **A unit test over `resolveDriver` cannot replace this.** That asserts which
 * driver is *named*; the gap was in what the named driver could *do*. These
 * assertions therefore go through `createDatabase` — the real construction
 * path, with no override — rather than building a client by hand.
 *
 * It **never drops a schema or table**: a misaimed `DATABASE_URL` would become
 * data loss. It runs one temporary table inside a transaction it rolls back,
 * and asserts the rollback as well as the commit, because a "transaction" that
 * silently ignores rollback would pass a commit-only test.
 */
describeWithDatabase("the configured driver against a real Postgres", () => {
  it("opens an interactive transaction and commits it", async () => {
    const handle = createDatabase({
      url: connectionString(),
      nodeEnv: process.env.NODE_ENV,
    });
    try {
      const seen = await handle.db.transaction(async (tx) => {
        const result = await tx.execute<{ answer: number }>(
          sql`select 1 as answer`,
        );
        return (result.rows as { answer: number }[])[0]?.answer;
      });
      expect(seen).toBe(1);
    } finally {
      await handle.close();
    }
  });

  // Interleaved reads and writes inside one transaction are what the Claim
  // needs: it reads availability, frees an expired hold, creates an Account and
  // holds the Handle, all atomically. A driver offering only batched statements
  // cannot do this, which is exactly what neon-http offered.
  it("reads its own uncommitted writes inside the transaction", async () => {
    const handle = createDatabase({
      url: connectionString(),
      nodeEnv: process.env.NODE_ENV,
    });
    try {
      const seen = await handle.db.transaction(async (tx) => {
        await tx.execute(
          sql`create temporary table claim_capability_probe (n integer) on commit drop`,
        );
        await tx.execute(
          sql`insert into claim_capability_probe (n) values (7)`,
        );
        const result = await tx.execute<{ n: number }>(
          sql`select n from claim_capability_probe`,
        );
        return (result.rows as { n: number }[])[0]?.n;
      });
      expect(seen).toBe(7);
    } finally {
      await handle.close();
    }
  });

  it("rolls back, so the transaction is real rather than nominal", async () => {
    const handle = createDatabase({
      url: connectionString(),
      nodeEnv: process.env.NODE_ENV,
    });
    try {
      await expect(
        handle.db.transaction(async (tx) => {
          await tx.execute(
            sql`create temporary table rollback_probe (n integer) on commit drop`,
          );
          throw new Error("deliberate rollback");
        }),
      ).rejects.toThrow("deliberate rollback");

      // The temporary table was dropped with the aborted transaction, so a
      // fresh statement cannot see it. If the "transaction" were nominal, the
      // create would have persisted for the session.
      const after = await handle.db.execute<{ present: boolean }>(
        sql`select to_regclass('pg_temp.rollback_probe') is not null as present`,
      );
      expect((after.rows as { present: boolean }[])[0]?.present).toBe(false);
    } finally {
      await handle.close();
    }
  });

  it("names node-postgres whatever NODE_ENV says, including production", () => {
    const handle = createDatabase({
      url: connectionString(),
      nodeEnv: "production",
    });
    expect(handle.driver).toBe("node-postgres");
    return handle.close();
  });
});
