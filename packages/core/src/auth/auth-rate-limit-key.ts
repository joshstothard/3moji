import { createHmac } from "node:crypto";

import { AUTH_RATE_LIMIT_MODEL } from "./auth-rate-limit";
import type {
  safeDatabaseAdapter,
  withSafeAdapterErrors,
} from "./safe-database-adapter";

/**
 * **This module imports no Better Auth specifier.** The adapter types are read
 * off `safe-database-adapter.ts`, so it stays outside
 * `scripts/better-auth-audit.mjs`'s list of modules that import Better Auth
 * (#169): it adds no endpoint and no plugin.
 */
type Adapter = ReturnType<typeof withSafeAdapterErrors>;
type TransactionAdapter = Parameters<Parameters<Adapter["transaction"]>[0]>[0];
type AdapterFactory = Parameters<typeof safeDatabaseAdapter>[0];
type WhereClause = Parameters<Adapter["findMany"]>[0]["where"];
type Where = NonNullable<WhereClause>[number];

/**
 * Domain separation for the key the counters are hashed under, distinct from
 * the Claim's label so the two tables' hashes can never be compared. Changing
 * it resets every counter, which is harmless: the longest window is an hour.
 */
const KEY_LABEL = "3moji auth rate limit key v1";

/** The field Better Auth's limiter identifies a counter by. */
const KEY_FIELD = "key";

function storedKeyHasher(secret: string): (key: string) => string {
  if (secret === "") {
    throw new Error(
      "Hashing auth rate-limit keys requires the auth secret; without one every stored key could be recomputed from a guessed address.",
    );
  }
  const derived = createHmac("sha256", secret).update(KEY_LABEL).digest();
  return (key) => createHmac("sha256", derived).update(key).digest("hex");
}

/**
 * The value `auth_rate_limit.key` holds for one of Better Auth's counters: an
 * HMAC-SHA256, hex, of Better Auth's own key — `<client address>|<path>` —
 * under a key derived from the auth secret
 * ([#214](https://github.com/joshstothard/3moji/issues/214)).
 *
 * **The same scheme as `keyedRateLimitBucket`**, and for the same reason: an
 * IPv4 address, or an IPv6 `/64`, has so little entropy that a plain hash could
 * be reversed by hashing every candidate. Without the secret it cannot. The
 * whole key is hashed, path included, so each path still has its own counter.
 */
export function authRateLimitStoredKey(secret: string, key: string): string {
  return storedKeyHasher(secret)(key);
}

function isRateLimitModel(model: string): boolean {
  // Better Auth's limiter names the logical model; the physical name is
  // matched too, so a caller addressing the table directly is hashed as well.
  return model === "rateLimit" || model === AUTH_RATE_LIMIT_MODEL;
}

/**
 * Better Auth's database adapter, with every rate-limit key hashed on its way
 * in ([#214](https://github.com/joshstothard/3moji/issues/214)).
 *
 * **Why the adapter, and not `rateLimit.customStorage`.** In better-auth 1.7.4
 * a custom storage *replaces* the database storage rather than wrapping it, and
 * the database storage (`createDatabaseStorageWrapper` in
 * `better-auth/dist/api/rate-limiter/index.mjs`) is not exported — so using it
 * would mean reimplementing its guarded increments, retries, pruning and
 * `X-Retry-After`. Here Better Auth's limiter runs untouched: it still builds
 * `<address>|<path>` and still decides every request, and only the value that
 * reaches the table changes. Its only calls on the `rateLimit` model are
 * `findMany` and `incrementOne` by `key`, `create` with `data.key`, and
 * `deleteMany` by `lastRequest`.
 *
 * Every method is covered, not only those four, so a version that starts
 * reading or writing the key another way is hashed too. Rows come back with
 * the stored key; the limiter reads only `count` and `lastRequest` from them.
 * Nothing here logs, and nothing it throws carries a key.
 */
export function withHashedRateLimitKeys(
  adapter: Adapter,
  secret: string,
): Adapter {
  const hash = storedKeyHasher(secret);
  return {
    ...hashedTransactionAdapter(adapter, hash),
    transaction: (callback) =>
      adapter.transaction((trx) =>
        callback(hashedTransactionAdapter(trx, hash)),
      ),
  };
}

function hashedTransactionAdapter(
  adapter: TransactionAdapter,
  hash: (key: string) => string,
): TransactionAdapter {
  function hashWhere(model: string, where: Where[]): Where[];
  function hashWhere(model: string, where: WhereClause): WhereClause;
  function hashWhere(model: string, where: WhereClause): WhereClause {
    if (where === undefined || !isRateLimitModel(model)) return where;
    return where.map((clause) => {
      if (clause.field !== KEY_FIELD) return clause;
      const { value } = clause;
      if (typeof value === "string") return { ...clause, value: hash(value) };
      if (Array.isArray(value) && value.every((v) => typeof v === "string")) {
        return { ...clause, value: value.map(hash) };
      }
      return clause;
    });
  }
  const hashFields = <T extends Record<string, unknown>>(
    model: string,
    fields: T,
  ): T => {
    const value = fields[KEY_FIELD];
    if (!isRateLimitModel(model) || typeof value !== "string") return fields;
    return { ...fields, [KEY_FIELD]: hash(value) };
  };

  return {
    ...adapter,
    create: (data) =>
      adapter.create({ ...data, data: hashFields(data.model, data.data) }),
    findOne: (data) =>
      adapter.findOne({ ...data, where: hashWhere(data.model, data.where) }),
    findMany: (data) =>
      adapter.findMany({ ...data, where: hashWhere(data.model, data.where) }),
    count: (data) =>
      adapter.count({ ...data, where: hashWhere(data.model, data.where) }),
    update: (data) =>
      adapter.update({
        ...data,
        where: hashWhere(data.model, data.where),
        update: hashFields(data.model, data.update),
      }),
    updateMany: (data) =>
      adapter.updateMany({
        ...data,
        where: hashWhere(data.model, data.where),
        update: hashFields(data.model, data.update),
      }),
    delete: (data) =>
      adapter.delete({ ...data, where: hashWhere(data.model, data.where) }),
    deleteMany: (data) =>
      adapter.deleteMany({ ...data, where: hashWhere(data.model, data.where) }),
    consumeOne: (data) =>
      adapter.consumeOne({ ...data, where: hashWhere(data.model, data.where) }),
    incrementOne: (data) =>
      adapter.incrementOne({
        ...data,
        where: hashWhere(data.model, data.where),
        ...(data.set === undefined
          ? {}
          : { set: hashFields(data.model, data.set) }),
      }),
  };
}

/** Better Auth's `database` option, as a factory of key-hashing adapters. */
export function hashedRateLimitKeys(
  factory: AdapterFactory,
  secret: string,
): AdapterFactory {
  return (options) => withHashedRateLimitKeys(factory(options), secret);
}
