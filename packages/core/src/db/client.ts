import { neon } from "@neondatabase/serverless";
import { drizzle as drizzleNeon } from "drizzle-orm/neon-http";
import { drizzle as drizzleNode } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import { resolveDriver, type DatabaseDriver } from "./driver";
import { authSchema } from "./schema";

export interface CreateDatabaseInput {
  /** The connection string. Passed in; never read from the environment here. */
  readonly url: string;
  /** The value of `NODE_ENV`, used to pick a driver when none is forced. */
  readonly nodeEnv?: string | undefined;
  /** Forces a driver, whatever the environment says. */
  readonly driver?: DatabaseDriver | undefined;
}

export type NodePostgresDatabase = ReturnType<
  typeof drizzleNode<typeof authSchema>
>;
export type NeonDatabase = ReturnType<typeof drizzleNeon<typeof authSchema>>;
export type Database = NodePostgresDatabase | NeonDatabase;

/**
 * A transaction opened on a {@link Database}, whichever driver it came from.
 *
 * **Derived from the drivers' own signatures rather than named**, because
 * Drizzle's transaction type is generic in its query-result and schema
 * parameters and spelling it out would restate three of them — each a chance to
 * disagree with the client the transaction actually came from.
 *
 * **Both shapes are here, and only one of them can ever exist at runtime.**
 * `Database` is a union, so `db.transaction(…)` hands its callback the union of
 * both transaction types and a type covering only node-postgres would not
 * compile. `drizzle-orm/neon-http` nonetheless throws "No transactions support
 * in neon-http driver" the moment `transaction` is called — the types promise
 * what that driver does not deliver. See
 * {@link ../adapters/drizzle-claim-store.createDrizzleClaimStore}, which is
 * where that matters and where it is reported.
 */
export type DatabaseTransaction =
  | Parameters<Parameters<NodePostgresDatabase["transaction"]>[0]>[0]
  | Parameters<Parameters<NeonDatabase["transaction"]>[0]>[0];

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
 * `close` exists because the node-postgres driver holds a connection pool, and
 * anything that opens one must be able to release it — a migration script, an
 * integration test, a one-off task. Without it a process hangs on exit for
 * reasons that are tedious to diagnose. For the Neon HTTP driver there is no
 * pool, so `close` is a no-op and callers need not care which they hold.
 */
export interface DatabaseHandle {
  readonly db: Database;
  readonly driver: DatabaseDriver;
  readonly close: () => Promise<void>;
}

/**
 * Builds a Drizzle client over the auth schema.
 *
 * Neither driver connects eagerly, so constructing this is cheap and safe at
 * module scope. Which driver is used is decided by `resolveDriver`
 * (ADR-0006 decision 6).
 */
export function createDatabase(input: CreateDatabaseInput): DatabaseHandle {
  if (input.url === "") {
    throw new Error(
      "createDatabase requires a connection string. Pass the value of DATABASE_URL rather than an empty string.",
    );
  }

  const driver = resolveDriver({
    nodeEnv: input.nodeEnv,
    override: input.driver,
  });

  if (driver === "neon-http") {
    return {
      db: drizzleNeon(neon(input.url), { schema: authSchema }),
      driver,
      close: () => Promise.resolve(),
    };
  }

  const pool = new Pool({ connectionString: input.url });
  return {
    db: drizzleNode(pool, { schema: authSchema }),
    driver,
    close: async () => {
      await pool.end();
    },
  };
}
