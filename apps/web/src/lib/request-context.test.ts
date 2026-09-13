/**
 * @jest-environment node
 */

/**
 * How code inside a request reads the correlation id the proxy set (#155).
 *
 * Two readers, for two kinds of caller. `readCorrelationId` is the documented
 * async path through `headers()`, for a route handler or server action that
 * can await (#156). `currentCorrelationId` is synchronous, for `logFailure`,
 * which runs inside catch blocks whose shape and timing must not change.
 *
 * Both re-apply the allow-list: the proxy's matcher skips some paths, and on
 * those a client-sent `x-correlation-id` would reach the app untouched.
 */
import "../test-support/next-async-local-storage";

import { workUnitAsyncStorage } from "next/dist/server/app-render/work-unit-async-storage.external";

const headers = jest.fn((): Promise<Headers> => Promise.resolve(new Headers()));
jest.mock("next/headers", () => ({ headers: () => headers() }));

import { NO_CORRELATION_ID } from "./correlation-id";
import {
  correlationIdOfStore,
  currentCorrelationId,
  readCorrelationId,
} from "./request-context";

const ID = "0f8fad5b-d9cb-469f-a165-70867728950e";
/**
 * `Headers` itself refuses a raw newline, so no request can carry one; the
 * JSON-breaking value is what can actually arrive.
 */
const FORGED = `${ID}"},{"event":"forged`;

/** A store shaped like the one Next.js keeps for a live request. */
function requestStore(values: Record<string, string>): unknown {
  return { type: "request", headers: new Headers(values) };
}

/**
 * Run `read` inside Next.js's real request store. `Reflect.apply` because the
 * store's declared type is a full `RequestStore`, and a cast to one would
 * assert shape this test deliberately does not build.
 */
function insideRequest(store: unknown, read: () => string): unknown {
  return Reflect.apply(
    workUnitAsyncStorage.run.bind(workUnitAsyncStorage),
    undefined,
    [store, read],
  );
}

describe("readCorrelationId", () => {
  it("answers the id the proxy put on the request", async () => {
    headers.mockResolvedValueOnce(new Headers({ "x-correlation-id": ID }));

    await expect(readCorrelationId()).resolves.toBe(ID);
  });

  it("answers the sentinel when the request carries no id", async () => {
    headers.mockResolvedValueOnce(new Headers());

    await expect(readCorrelationId()).resolves.toBe(NO_CORRELATION_ID);
  });

  it("never passes on a malformed id", async () => {
    headers.mockResolvedValueOnce(
      new Headers({ "x-correlation-id": `abc"def` }),
    );

    await expect(readCorrelationId()).resolves.toBe(NO_CORRELATION_ID);
  });

  it("answers the sentinel rather than rejecting outside a request", async () => {
    headers.mockImplementationOnce(() => {
      throw new Error("`headers` was called outside a request scope.");
    });

    await expect(readCorrelationId()).resolves.toBe(NO_CORRELATION_ID);
  });
});

describe("correlationIdOfStore", () => {
  it("reads the id from a request store", () => {
    expect(correlationIdOfStore(requestStore({ "x-correlation-id": ID }))).toBe(
      ID,
    );
  });

  it.each([
    ["no store at all", undefined],
    [
      "a store that is not a request",
      { type: "prerender", headers: new Headers({ "x-correlation-id": ID }) },
    ],
    ["a request store with no id", requestStore({})],
    [
      "a request store whose headers are not Headers",
      { type: "request", headers: {} },
    ],
    ["a malformed id", requestStore({ "x-correlation-id": `{"a":1}` })],
  ])("answers the sentinel for %s", (_what, store) => {
    expect(correlationIdOfStore(store)).toBe(NO_CORRELATION_ID);
  });

  it("never throws, even when reading the store does", () => {
    const hostile = {
      type: "request",
      get headers(): never {
        throw new Error("boom");
      },
    };

    expect(correlationIdOfStore(hostile)).toBe(NO_CORRELATION_ID);
  });
});

describe("currentCorrelationId", () => {
  it("answers the sentinel outside a request, without throwing", () => {
    expect(currentCorrelationId()).toBe(NO_CORRELATION_ID);
  });

  it("reads the live request's id from Next.js's own request store", () => {
    // This pins a Next.js internal: the synchronous store `headers()` itself
    // reads. If an upgrade moves or reshapes it, this goes red rather than
    // every log line silently degrading to the sentinel.
    expect(
      insideRequest(requestStore({ "x-correlation-id": ID }), () =>
        currentCorrelationId(),
      ),
    ).toBe(ID);
  });

  it("never passes on a forged id from the live request", () => {
    expect(
      insideRequest(requestStore({ "x-correlation-id": FORGED }), () =>
        currentCorrelationId(),
      ),
    ).toBe(NO_CORRELATION_ID);
  });
});
