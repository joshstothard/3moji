import type { DBAdapter } from "better-auth/types";

import {
  authRateLimitStoredKey,
  hashedRateLimitKeys,
  withHashedRateLimitKeys,
} from "./auth-rate-limit-key";

const SECRET = "unit-test-secret-of-sufficient-length-214";
const ADDRESS = "198.51.100.7";
const KEY = `${ADDRESS}|/sign-in/email`;

interface Call {
  readonly method: string;
  readonly input: unknown;
}

/** What the recorder answers with; every call below expects it. */
class Recorded extends Error {}

/**
 * An adapter that records what reached it. It answers by rejecting, which
 * types as every method's result without an assertion; callers catch it.
 */
function recordingAdapter(calls: Call[]): DBAdapter {
  const record = (method: string) => (input: unknown) => {
    calls.push({ method, input });
    return Promise.reject(new Recorded());
  };
  const adapter: DBAdapter = {
    id: "recording",
    create: record("create"),
    findOne: record("findOne"),
    findMany: record("findMany"),
    count: record("count"),
    update: record("update"),
    updateMany: record("updateMany"),
    delete: record("delete"),
    deleteMany: record("deleteMany"),
    consumeOne: record("consumeOne"),
    incrementOne: record("incrementOne"),
    transaction: (callback) => callback(adapter),
  };
  return adapter;
}

/** Swallow the recorder's answer, and nothing else. */
async function recorded(call: Promise<unknown>): Promise<void> {
  try {
    await call;
  } catch (error) {
    if (!(error instanceof Recorded)) throw error;
  }
}

/** Better Auth 1.7.4's rate limiter's four calls, verbatim in shape. */
async function limiterCalls(
  adapter: Omit<DBAdapter, "transaction">,
): Promise<void> {
  await recorded(
    adapter.findMany({
      model: "rateLimit",
      where: [{ field: "key", value: KEY }],
    }),
  );
  await recorded(
    adapter.create({
      model: "rateLimit",
      data: { key: KEY, count: 1, lastRequest: 1 },
    }),
  );
  await recorded(
    adapter.incrementOne({
      model: "rateLimit",
      where: [
        { field: "key", value: KEY },
        { field: "lastRequest", operator: "gt", value: 0 },
        { field: "count", operator: "lt", value: 10 },
      ],
      increment: { count: 1 },
      set: { lastRequest: 2 },
    }),
  );
  await recorded(
    adapter.deleteMany({
      model: "rateLimit",
      where: [{ field: "lastRequest", operator: "lt", value: 0 }],
    }),
  );
}

const HASHED = authRateLimitStoredKey(SECRET, KEY);

describe("authRateLimitStoredKey", () => {
  it("is a hex HMAC-SHA256 that holds neither the address nor the path", () => {
    expect(HASHED).toMatch(/^[0-9a-f]{64}$/);
    expect(HASHED).not.toContain(ADDRESS);
    expect(HASHED).not.toContain("sign-in");
  });

  it("is stable for one secret, and different under another", () => {
    expect(authRateLimitStoredKey(SECRET, KEY)).toBe(HASHED);
    expect(authRateLimitStoredKey(`${SECRET}-rotated`, KEY)).not.toBe(HASHED);
  });

  it("keeps a separate counter per client and per path", () => {
    expect(
      new Set([
        HASHED,
        authRateLimitStoredKey(SECRET, `${ADDRESS}|/request-password-reset`),
        authRateLimitStoredKey(SECRET, "198.51.100.8|/sign-in/email"),
      ]).size,
    ).toBe(3);
  });

  it("refuses an empty secret, which would make every key recomputable", () => {
    expect(() => authRateLimitStoredKey("", KEY)).toThrow(/auth secret/);
  });
});

describe("withHashedRateLimitKeys", () => {
  it("hashes the key in each call Better Auth's limiter makes, and nothing else", async () => {
    const calls: Call[] = [];
    await limiterCalls(
      withHashedRateLimitKeys(recordingAdapter(calls), SECRET),
    );

    expect(calls).toEqual([
      {
        method: "findMany",
        input: { model: "rateLimit", where: [{ field: "key", value: HASHED }] },
      },
      {
        method: "create",
        input: {
          model: "rateLimit",
          data: { key: HASHED, count: 1, lastRequest: 1 },
        },
      },
      {
        method: "incrementOne",
        input: {
          model: "rateLimit",
          where: [
            { field: "key", value: HASHED },
            { field: "lastRequest", operator: "gt", value: 0 },
            { field: "count", operator: "lt", value: 10 },
          ],
          increment: { count: 1 },
          set: { lastRequest: 2 },
        },
      },
      {
        method: "deleteMany",
        input: {
          model: "rateLimit",
          where: [{ field: "lastRequest", operator: "lt", value: 0 }],
        },
      },
    ]);
  });

  it("hashes inside a transaction too", async () => {
    const calls: Call[] = [];
    await withHashedRateLimitKeys(recordingAdapter(calls), SECRET).transaction(
      (trx) => limiterCalls(trx),
    );

    expect(calls).toHaveLength(4);
    expect(JSON.stringify(calls)).not.toContain(ADDRESS);
  });

  it("hashes the table under its physical name, and a list of keys", async () => {
    const calls: Call[] = [];
    await recorded(
      withHashedRateLimitKeys(recordingAdapter(calls), SECRET).deleteMany({
        model: "auth_rate_limit",
        where: [{ field: "key", operator: "in", value: [KEY, KEY] }],
      }),
    );

    expect(calls).toEqual([
      {
        method: "deleteMany",
        input: {
          model: "auth_rate_limit",
          where: [{ field: "key", operator: "in", value: [HASHED, HASHED] }],
        },
      },
    ]);
  });

  it("leaves every other model's fields as they are", async () => {
    const calls: Call[] = [];
    const adapter = withHashedRateLimitKeys(recordingAdapter(calls), SECRET);
    await recorded(
      adapter.findOne({
        model: "verification",
        where: [{ field: "key", value: KEY }],
      }),
    );
    await recorded(adapter.create({ model: "user", data: { key: KEY } }));

    expect(calls).toEqual([
      {
        method: "findOne",
        input: { model: "verification", where: [{ field: "key", value: KEY }] },
      },
      { method: "create", input: { model: "user", data: { key: KEY } } },
    ]);
  });

  it("wraps a factory, as createAuth passes it", async () => {
    const calls: Call[] = [];
    const factory = hashedRateLimitKeys(() => recordingAdapter(calls), SECRET);
    await limiterCalls(factory({}));

    expect(calls).toHaveLength(4);
    expect(JSON.stringify(calls)).not.toContain(ADDRESS);
  });
});
