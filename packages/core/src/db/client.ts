import { drizzle as drizzleNode } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import { resolveDriver, type DatabaseDriver } from "./driver";
import { authSchema } from "./schema";

export interface CreateDatabaseInput {
  /** The connection string. Passed in; never read from the environment here. */
  readonly url: string;
  /**
   * The value of `NODE_ENV`. Kept so callers need not change, and deliberately
   * no longer able to select a driver — see {@link ./driver.resolveDriver} and
   * ADR-0010.
   */
  readonly nodeEnv?: string | undefined;
}

export type NodePostgresDatabase = ReturnType<
  typeof drizzleNode<typeof authSchema>
>;

/**
 * The one client shape. **No longer a union** — ADR-0010 puts every environment
 * on `node-postgres`, so a second driver's type cannot reach a caller.
 */
export type Database = NodePostgresDatabase;

/**
 * A transaction opened on a {@link Database}.
 *
 * **Derived from the driver's own signature rather than named**, because
 * Drizzle's transaction type is generic in its query-result and schema
 * parameters and spelling it out would restate them — each a chance to
 * disagree with the client the transaction actually came from.
 *
 * This was a union of two drivers' transaction types, and the second could not
 * open one: `drizzle-orm/neon-http` throws "No transactions support in
 * neon-http driver" the moment `transaction` is called, so its types promised
 * what it did not deliver. ADR-0010 removed that driver, and with it the gap
 * between what the type said and what the runtime did.
 */
export type DatabaseTransaction = Parameters<
  Parameters<NodePostgresDatabase["transaction"]>[0]
>[0];

/**
 * Anything a read or a write may be issued against: the client, or a
 * transaction opened on it.
 *
 * A repository that takes this works identically inside and outside a
 * transaction, which is what lets the Claim reuse the same availability read
 * the resolve path uses instead of a second copy that could disagree with it.
 */
export type DatabaseOrTransaction = Database | DatabaseTransaction;

/**
 * A database client plus the means to release it.
 *
 * `close` exists because `node-postgres` holds a connection pool, and anything
 * that opens one must be able to release it — a migration script, an
 * integration test, a one-off task. Without it a process hangs on exit for
 * reasons that are tedious to diagnose.
 */
export interface DatabaseHandle {
  readonly db: Database;
  readonly driver: DatabaseDriver;
  readonly close: () => Promise<void>;
}

/**
 * Builds a Drizzle client over the auth schema.
 *
 * The driver does not connect eagerly, so constructing this is cheap and safe
 * at module scope. There is one driver in every environment (ADR-0010), and
 * `resolveDriver` is where that is stated and tested.
 */
export function createDatabase(input: CreateDatabaseInput): DatabaseHandle {
  if (input.url === "") {
    throw new Error(
      "createDatabase requires a connection string. Pass the value of DATABASE_URL rather than an empty string.",
    );
  }

  const driver = resolveDriver({ nodeEnv: input.nodeEnv });

  const pool = new Pool({ connectionString: input.url });
  return {
    db: drizzleNode(pool, { schema: authSchema }),
    driver,
    close: async () => {
      await pool.end();
    },
  };
}
