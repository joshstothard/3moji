import path from "node:path";

import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";

const url = process.env.DATABASE_URL;

// Fail loudly rather than skipping silently in CI: a green run that tested
// nothing is worse than a red one.
if (url === undefined && process.env.CI !== undefined) {
  throw new Error(
    "DATABASE_URL is not set. CI's integration-tests job must provide a Postgres service.",
  );
}

const describeWithDatabase = url === undefined ? describe.skip : describe;

// Anchored to this file rather than the working directory. A cwd-relative path
// works when Jest runs from the package root and fails confusingly when it does
// not, which is exactly the kind of difference that only shows up in CI.
const MIGRATIONS = path.join(__dirname, "..", "..", "migrations");

/**
 * These tests deliberately **never drop a schema or a table.** Resetting the
 * database would be convenient, and it is how integration suites often start,
 * but it turns a misaimed DATABASE_URL into data loss. Drizzle's migrator is
 * idempotent, which is the property worth asserting anyway, so the suite works
 * against a fresh database and an already-migrated one alike.
 */
describeWithDatabase("the auth migration against a real Postgres", () => {
  const TEST_USER = "integration-test-user";
  const TEST_SESSION = "integration-test-session";
  let pool: Pool;
  let db: ReturnType<typeof drizzle>;

  beforeAll(() => {
    pool = new Pool({ connectionString: url });
    db = drizzle(pool);
  });

  afterAll(async () => {
    await db.execute(sql`DELETE FROM "user" WHERE id = ${TEST_USER}`);
    await pool.end();
  });

  const tableExists = async (name: string): Promise<boolean> => {
    const result = await db.execute<{ exists: boolean }>(sql`
      SELECT EXISTS (
        SELECT FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = ${name}
      ) AS exists
    `);
    return (result.rows as { exists: boolean }[])[0]?.exists === true;
  };

  it("applies and creates every auth table", async () => {
    await migrate(db, { migrationsFolder: MIGRATIONS });

    for (const name of ["user", "session", "account", "verification"]) {
      expect(await tableExists(name)).toBe(true);
    }
  });

  it("is a no-op when run a second time", async () => {
    await expect(
      migrate(db, { migrationsFolder: MIGRATIONS }),
    ).resolves.not.toThrow();

    expect(await tableExists("user")).toBe(true);
  });

  /**
   * The literal is spelled out rather than read from `_journal.json`, so
   * committing a migration is a deliberate edit here. Deriving it would
   * parameterise the test on the value it constrains and it would then pass
   * however many migrations appeared — including a duplicate applied twice,
   * which is the failure this is here to catch.
   *
   * **So this number has to be bumped by hand with every new migration**, and
   * it will be red in CI rather than locally: it counts rows in a real
   * database, so nothing on a machine without one can tell you it is stale. It
   * has already moved 1 → 2 (`handle`), 2 → 3 (the blocked-emoji `CHECK`),
   * 3 → 4 (`verification_dispatch`), 4 → 5 (`released_handle`), 5 → 6
   * (`profile` and `link`) and 6 → 7 (`claim_rate_limit`). If you are reading
   * this because CI says `Expected: "7" / Received: "8"`, your migration is the
   * eighth and this
   * literal is what needs the edit — it is tracking
   * `migrations/meta/_journal.json`.
   */
  it("applies each committed migration exactly once", async () => {
    const result = await db.execute<{ count: string }>(sql`
      SELECT count(*) AS count FROM drizzle.__drizzle_migrations
    `);
    expect((result.rows as { count: string }[])[0]?.count).toBe("7");
  });

  it("cascades a session delete when its user is removed", async () => {
    await db.execute(sql`
      INSERT INTO "user" (id, name, email)
      VALUES (${TEST_USER}, 'Integration Test', ${`${TEST_USER}@example.com`})
      ON CONFLICT (id) DO NOTHING
    `);
    await db.execute(sql`
      INSERT INTO "session" (id, expires_at, token, user_id)
      VALUES (${TEST_SESSION}, now() + interval '1 day', ${TEST_SESSION}, ${TEST_USER})
      ON CONFLICT (id) DO NOTHING
    `);

    await db.execute(sql`DELETE FROM "user" WHERE id = ${TEST_USER}`);

    const result = await db.execute<{ count: string }>(
      sql`SELECT count(*) AS count FROM "session" WHERE id = ${TEST_SESSION}`,
    );
    expect((result.rows as { count: string }[])[0]?.count).toBe("0");
  });
});
