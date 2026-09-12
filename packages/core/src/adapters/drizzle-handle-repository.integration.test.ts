import path from "node:path";

import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";

import {
  HANDLE_KEY_LENGTH,
  toHandleKey,
  type HandleKey,
} from "../db/handle-key";
import { authSchema } from "../db/schema";
import { releasedEmojiSet } from "../emoji/emoji-set";

import { createDrizzleHandleRepository } from "./drizzle-handle-repository";

const url = process.env.DATABASE_URL;

// Fail loudly rather than skipping silently in CI: a green run that tested
// nothing is worse than a red one.
if (url === undefined && process.env.CI !== undefined) {
  throw new Error(
    "DATABASE_URL is not set. CI's integration-tests job must provide a Postgres service.",
  );
}

const describeWithDatabase = url === undefined ? describe.skip : describe;

const MIGRATIONS = path.join(__dirname, "..", "..", "migrations");

/** Every row this suite creates carries this prefix, and only these are deleted. */
const PREFIX = "integration-test-availability";

/** A Handle from the Emoji Set, canonicalised the way the write path does. */
function handleKeyFromSet(offset: number): HandleKey {
  const emoji = releasedEmojiSet
    .slice(offset, offset + HANDLE_KEY_LENGTH)
    .map((entry) => entry.emoji)
    .join("");
  const key = toHandleKey(emoji);
  if (key === undefined) {
    throw new Error(
      `the released Emoji Set did not yield a canonicalisable Handle at offset ${String(offset)}.`,
    );
  }
  return key;
}

/**
 * These tests **never drop a schema or a table** — a misaimed `DATABASE_URL`
 * would become data loss. They create rows under a known prefix and delete
 * exactly those.
 *
 * What only a real database can prove: that the query finds the row at all
 * under the deterministic `C` collation, and that the emoji key round-trips
 * through Postgres unchanged. The expiry *rule* is unit-tested against a fake
 * clock in `handle-ownership.test.ts`, because a rule only provable against
 * Postgres is a rule nobody exercises on every run.
 */
describeWithDatabase(
  "the Drizzle Handle repository against a real Postgres",
  () => {
    let pool: Pool;
    // Typed with the auth schema, because `Database` is — a bare `drizzle(pool)`
    // infers `Record<string, unknown>` and will not satisfy the port's adapter.
    let db: ReturnType<typeof drizzle<typeof authSchema>>;

    const NOW = new Date("2026-09-12T12:00:00.000Z");
    const LATER = new Date("2026-09-13T12:00:00.000Z");
    const EARLIER = new Date("2026-09-11T12:00:00.000Z");

    const createAccount = async (id: string): Promise<void> => {
      await db.execute(sql`
      INSERT INTO "user" (id, name, email)
      VALUES (${id}, 'Integration Test', ${`${id}@example.com`})
      ON CONFLICT (id) DO NOTHING
    `);
    };

    const insertHandle = async (input: {
      key: HandleKey;
      userId: string;
      heldUntil: Date;
      claimedAt: Date | null;
    }): Promise<void> => {
      await createAccount(input.userId);
      await db.execute(sql`
      INSERT INTO "handle" (key, user_id, held_until, claimed_at)
      VALUES (${input.key}, ${input.userId}, ${input.heldUntil.toISOString()}, ${input.claimedAt === null ? null : input.claimedAt.toISOString()})
    `);
    };

    const removeOwnRows = async (): Promise<void> => {
      await db.execute(sql`DELETE FROM "user" WHERE id LIKE ${`${PREFIX}%`}`);
    };

    beforeAll(async () => {
      pool = new Pool({ connectionString: url });
      db = drizzle(pool, { schema: authSchema });
      await migrate(db, { migrationsFolder: MIGRATIONS });
      // Before as well as after: a run killed mid-suite leaves rows behind.
      await removeOwnRows();
    });

    afterAll(async () => {
      await removeOwnRows();
      await pool.end();
    });

    it("reports a key with no row as available", async () => {
      const repository = createDrizzleHandleRepository(db);
      expect(await repository.availabilityOf(handleKeyFromSet(0), NOW)).toBe(
        "available",
      );
    });

    it("reports a live hold as held", async () => {
      const key = handleKeyFromSet(3);
      await insertHandle({
        key,
        userId: `${PREFIX}-held`,
        heldUntil: LATER,
        claimedAt: null,
      });
      const repository = createDrizzleHandleRepository(db);
      expect(await repository.availabilityOf(key, NOW)).toBe("held");
    });

    it("reports a claimed Handle as claimed", async () => {
      const key = handleKeyFromSet(6);
      await insertHandle({
        key,
        userId: `${PREFIX}-claimed`,
        heldUntil: LATER,
        claimedAt: EARLIER,
      });
      const repository = createDrizzleHandleRepository(db);
      expect(await repository.availabilityOf(key, NOW)).toBe("claimed");
    });

    // The row is still there. Nothing frees it — that is #83's job — so this
    // asserts the read reinterprets it rather than the write removing it.
    it("reports an expired hold as available, leaving the row in place", async () => {
      const key = handleKeyFromSet(9);
      await insertHandle({
        key,
        userId: `${PREFIX}-expired`,
        heldUntil: EARLIER,
        claimedAt: null,
      });
      const repository = createDrizzleHandleRepository(db);
      expect(await repository.availabilityOf(key, NOW)).toBe("available");

      const rows = await db.execute<{ count: string }>(
        sql`SELECT count(*) AS count FROM "handle" WHERE key = ${key}`,
      );
      expect((rows.rows as { count: string }[])[0]?.count).toBe("1");
    });

    // Postgres, not the test, has to agree about the key. A collation or
    // encoding problem would surface as "available" for a row that exists.
    it("finds a row by its emoji key, so the key round-trips through Postgres", async () => {
      const key = handleKeyFromSet(12);
      await insertHandle({
        key,
        userId: `${PREFIX}-roundtrip`,
        heldUntil: LATER,
        claimedAt: EARLIER,
      });
      const repository = createDrizzleHandleRepository(db);
      expect(await repository.availabilityOf(key, NOW)).toBe("claimed");
      // A different Handle must not match it.
      expect(await repository.availabilityOf(handleKeyFromSet(15), NOW)).toBe(
        "available",
      );
    });
  },
);
