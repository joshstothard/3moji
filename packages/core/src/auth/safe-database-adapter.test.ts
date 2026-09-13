import { APIError } from "better-auth/api";
import type { DBAdapter } from "better-auth/types";

import { DatabaseQueryFailed } from "../db/database-error";
import {
  safeDatabaseAdapter,
  withSafeAdapterErrors,
} from "./safe-database-adapter";

const EMAIL = "someone-148@example.com";

/** The shape drizzle-orm 0.45.2 gives a failed statement, address bound. */
function failedQuery(): Error {
  const error = new Error(
    `Failed query: select "id" from "user" where "user"."email" = $1\nparams: ${EMAIL}`,
  );
  return Object.assign(error, {
    query: 'select "id" from "user" where "user"."email" = $1',
    params: [EMAIL],
    cause: Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:5432"), {
      code: "ECONNREFUSED",
    }),
  });
}

/** An adapter whose every statement fails with `failure`. */
function failingAdapter(failure: () => unknown): DBAdapter {
  const reject = (): Promise<never> =>
    // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- the value under test is deliberately any thrown value, not only an Error
    Promise.reject(failure());
  const adapter: DBAdapter = {
    id: "drizzle",
    create: reject,
    findOne: reject,
    findMany: reject,
    count: reject,
    update: reject,
    updateMany: reject,
    delete: reject,
    deleteMany: reject,
    consumeOne: reject,
    incrementOne: reject,
    transaction: (callback) => callback(adapter),
  };
  return adapter;
}

const WHERE = [{ field: "email", value: EMAIL }];

/** One call per adapter method, each binding the address. */
function everyMethod(
  adapter: Omit<DBAdapter, "transaction">,
): [string, () => Promise<unknown>][] {
  return [
    ["create", () => adapter.create({ model: "user", data: { email: EMAIL } })],
    ["findOne", () => adapter.findOne({ model: "user", where: WHERE })],
    ["findMany", () => adapter.findMany({ model: "user", where: WHERE })],
    ["count", () => adapter.count({ model: "user", where: WHERE })],
    [
      "update",
      () =>
        adapter.update({ model: "user", where: WHERE, update: { name: "x" } }),
    ],
    [
      "updateMany",
      () =>
        adapter.updateMany({
          model: "user",
          where: WHERE,
          update: { name: "x" },
        }),
    ],
    ["delete", () => adapter.delete({ model: "user", where: WHERE })],
    ["deleteMany", () => adapter.deleteMany({ model: "user", where: WHERE })],
    [
      "consumeOne",
      () => adapter.consumeOne({ model: "verification", where: WHERE }),
    ],
    [
      "incrementOne",
      () =>
        adapter.incrementOne({
          model: "user",
          where: WHERE,
          increment: { count: 1 },
        }),
    ],
  ];
}

async function rejectionOf(work: Promise<unknown>): Promise<unknown> {
  try {
    await work;
  } catch (error) {
    return error;
  }
  throw new Error("expected the call to reject, and it resolved.");
}

function expectSafe(error: unknown): void {
  expect(error).toBeInstanceOf(DatabaseQueryFailed);
  expect(error).toMatchObject({ code: "ECONNREFUSED" });
  expect(JSON.stringify(error)).not.toContain(EMAIL);
  expect(String(error)).not.toContain(EMAIL);
}

describe("withSafeAdapterErrors (#148)", () => {
  it.each(everyMethod(withSafeAdapterErrors(failingAdapter(failedQuery))))(
    "replaces a failed statement from %s",
    async (_method, call) => {
      expectSafe(await rejectionOf(call()));
    },
  );

  it("replaces a failed statement issued inside a transaction", async () => {
    const adapter = withSafeAdapterErrors(failingAdapter(failedQuery));

    for (const [, call] of everyMethod(adapter)) {
      const error = await rejectionOf(
        adapter.transaction(async (trx) => {
          await everyMethod(trx)[0]?.[1]();
          return call();
        }),
      );
      expectSafe(error);
    }
  });

  it("wraps the adapter a transaction hands its callback, not only the transaction", async () => {
    const adapter = withSafeAdapterErrors(failingAdapter(failedQuery));
    const seenInside: unknown[] = [];

    await rejectionOf(
      adapter.transaction(async (trx) => {
        try {
          await trx.findOne({ model: "user", where: WHERE });
        } catch (error) {
          // What Better Auth itself would catch and log inside a transaction.
          seenInside.push(error);
        }
        return trx.count({ model: "user", where: WHERE });
      }),
    );

    expect(seenInside).toHaveLength(1);
    expectSafe(seenInside[0]);
  });

  it("passes Better Auth's APIError through as the same value, status and body intact", async () => {
    const refusal = APIError.from("FORBIDDEN", {
      message: "Email not verified",
      code: "EMAIL_NOT_VERIFIED",
    });
    const adapter = withSafeAdapterErrors(failingAdapter(() => refusal));

    const error = await rejectionOf(
      adapter.findOne({ model: "user", where: WHERE }),
    );

    expect(error).toBe(refusal);
    expect(error).toMatchObject({
      status: "FORBIDDEN",
      body: { code: "EMAIL_NOT_VERIFIED" },
    });
  });

  it("passes an error that is not the database's through as the same value", async () => {
    const own = new Error("the adapter was misconfigured");
    const adapter = withSafeAdapterErrors(failingAdapter(() => own));

    expect(await rejectionOf(adapter.count({ model: "user" }))).toBe(own);
  });

  it("returns what the adapter returns, and keeps its id and options", async () => {
    const inner: DBAdapter = {
      ...failingAdapter(failedQuery),
      options: { adapterConfig: { adapterId: "drizzle" } },
      count: () => Promise.resolve(7),
    };

    const adapter = withSafeAdapterErrors(inner);

    await expect(adapter.count({ model: "user" })).resolves.toBe(7);
    expect(adapter.id).toBe("drizzle");
    expect(adapter.options).toBe(inner.options);
  });

  it("builds a safe adapter from every adapter the factory builds", async () => {
    const factory = jest.fn(() => failingAdapter(failedQuery));

    const adapter = safeDatabaseAdapter(factory)({});

    expect(factory).toHaveBeenCalledWith({});
    expectSafe(
      await rejectionOf(adapter.findOne({ model: "user", where: WHERE })),
    );
  });
});
