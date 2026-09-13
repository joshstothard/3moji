/**
 * @jest-environment node
 */

/**
 * Which correlation id a request is given (#155).
 *
 * The id is written into every structured log line and onto the response, so
 * **a client must never be able to choose its text**. An incoming value is
 * accepted only when it passes an allow-list of characters and length; any
 * other value is replaced by a fresh random id and never repeated anywhere.
 */
import {
  isSafeCorrelationId,
  NO_CORRELATION_ID,
  resolveCorrelationId,
} from "./correlation-id";

const UUID_V4 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** A value in the shape Vercel's edge sends: region hops, then a request id. */
const VERCEL_ID = "lhr1::iad1::8x2kq-1757770000000-3f9a1c2b7d4e";

/**
 * Everything a hostile client might send in place of an id. Each is a way to
 * forge a log line, break out of a JSON string, or smuggle text a reader
 * would believe. Control characters are built with `String.fromCharCode` so
 * no raw control character sits in this file.
 */
const MALFORMED: readonly (readonly [string, string])[] = [
  [
    "a newline that would forge a second log line",
    `${VERCEL_ID}${String.fromCharCode(10)}{"event":"forged"}`,
  ],
  ["a carriage return", `${VERCEL_ID}${String.fromCharCode(13)}`],
  ["a double quote that would close the JSON string", `abc"def`],
  ["JSON braces", `{"correlationId":"x"}`],
  ["an overlong value", "a".repeat(129)],
  ["non-ASCII text", "lhr1::café"],
  ["an emoji", "\u{1F9CA}"],
  ["a space", "lhr1:: iad1"],
  ["an empty string", ""],
  ["the sentinel that means no request", NO_CORRELATION_ID],
];

describe("isSafeCorrelationId", () => {
  it.each([
    ["a Vercel id", VERCEL_ID],
    ["a random UUID", "0f8fad5b-d9cb-469f-a165-70867728950e"],
    ["a value of exactly 128 characters", "a".repeat(128)],
  ])("accepts %s", (_what, value) => {
    expect(isSafeCorrelationId(value)).toBe(true);
  });

  it.each(MALFORMED)("rejects %s", (_what, value) => {
    expect(isSafeCorrelationId(value)).toBe(false);
  });

  it.each([
    ["undefined", undefined],
    ["null", null],
    ["a number", 42],
  ])("rejects %s", (_what, value) => {
    expect(isSafeCorrelationId(value)).toBe(false);
  });
});

describe("resolveCorrelationId", () => {
  it("uses a well-formed x-vercel-id as it is", () => {
    expect(resolveCorrelationId(VERCEL_ID)).toBe(VERCEL_ID);
  });

  it("generates a random UUID when there is no x-vercel-id", () => {
    const id = resolveCorrelationId(null);

    expect(id).toMatch(UUID_V4);
    expect(resolveCorrelationId(null)).not.toBe(id);
  });

  it.each(MALFORMED)(
    "replaces %s with a fresh UUID, never echoing it",
    (_what, value) => {
      const id = resolveCorrelationId(value);

      expect(id).toMatch(UUID_V4);
      expect(id).not.toBe(value);
    },
  );
});
