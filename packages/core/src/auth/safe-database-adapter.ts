import type {
  BetterAuthOptions,
  DBAdapter,
  DBTransactionAdapter,
} from "better-auth/types";

import { withSafeDatabaseErrors } from "../db/database-error";

/**
 * Better Auth's database adapter, with every database error it raises replaced
 * by `DatabaseQueryFailed` **before Better Auth sees it**
 * ([#148](https://github.com/joshstothard/3moji/issues/148)).
 *
 * #144 made the errors leaving our own adapters safe, but sign-in, the session
 * read, verification, password reset and sign-up issue their statements
 * through Better Auth's Drizzle adapter, which our adapters never see. Measured
 * against better-auth 1.7.4 with the database refusing every statement, a raw
 * `DrizzleQueryError` — whose message is `Failed query: …\nparams: <the email
 * address>` — reached three places:
 *
 * 1. the value `auth.api.*` rejects with, on sign-in, verification and both
 *    reset endpoints, none of which catch;
 * 2. Better Auth's logger, whose default sink is `console.error`: the session
 *    read and sign-up catch and throw a clean `APIError`, but log the raw error
 *    first;
 * 3. better-call's router, which `console.error`s any error that is not an
 *    `APIError` before answering the HTTP route with a 500.
 *
 * **Why here, and not at the `apps/web` call sites.** A call-site wrapper
 * reaches only (1). This one sits between Better Auth and drizzle-orm, so all
 * three receive an error that was already safe, and it covers every auth
 * instance there is — the pooled one and the one the Claim rebuilds against
 * its transaction — because `createAuth` is the only thing that builds one.
 *
 * **What it does not reach.** The adapter factory Better Auth wraps around
 * this adapter's *inner* Drizzle calls opens an OpenTelemetry span per
 * statement and records the raw exception on it. That span exists only if
 * `@opentelemetry/api` is installed, which it is not; see `AGENTS.md`
 * § Observability for the proposed decision.
 *
 * Anything that is not a database error — Better Auth's `APIError`, its
 * `BetterAuthError` — passes through as the same value, so callers that read
 * `status` or `body.code` are unaffected.
 */
export function withSafeAdapterErrors(adapter: DBAdapter): DBAdapter {
  return {
    ...safeTransactionAdapter(adapter),
    transaction: (callback) =>
      withSafeDatabaseErrors(() =>
        adapter.transaction((trx) => callback(safeTransactionAdapter(trx))),
      ),
  };
}

/** The same replacement for the adapter a transaction hands its callback. */
function safeTransactionAdapter(
  adapter: DBTransactionAdapter,
): DBTransactionAdapter {
  return {
    ...adapter,
    create: (data) => withSafeDatabaseErrors(() => adapter.create(data)),
    findOne: (data) => withSafeDatabaseErrors(() => adapter.findOne(data)),
    findMany: (data) => withSafeDatabaseErrors(() => adapter.findMany(data)),
    count: (data) => withSafeDatabaseErrors(() => adapter.count(data)),
    update: (data) => withSafeDatabaseErrors(() => adapter.update(data)),
    updateMany: (data) =>
      withSafeDatabaseErrors(() => adapter.updateMany(data)),
    delete: (data) => withSafeDatabaseErrors(() => adapter.delete(data)),
    deleteMany: (data) =>
      withSafeDatabaseErrors(() => adapter.deleteMany(data)),
    consumeOne: (data) =>
      withSafeDatabaseErrors(() => adapter.consumeOne(data)),
    incrementOne: (data) =>
      withSafeDatabaseErrors(() => adapter.incrementOne(data)),
  };
}

/** Better Auth's `database` option, as a factory of safe adapters. */
export function safeDatabaseAdapter(
  factory: (options: BetterAuthOptions) => DBAdapter,
): (options: BetterAuthOptions) => DBAdapter {
  return (options) => withSafeAdapterErrors(factory(options));
}
