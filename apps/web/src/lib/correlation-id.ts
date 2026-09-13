/**
 * The correlation id every request is given, and the rule for accepting one
 * (#155).
 *
 * The id is written into every structured log line (`logFailure`, and the
 * boundary line #156 adds) and onto the response as `x-correlation-id`. So
 * **a client must never be able to choose its text**: a value that could hold
 * a newline, a quote or a brace could forge a log line or break out of the
 * JSON string it sits in.
 *
 * The rule is an allow-list of characters and length, not a grammar.
 * `x-vercel-id` is documented only as the Vercel regions a request passed
 * through and the one it ran in; its exact format is not published, so this
 * does not pretend to know it. What it pins is what matters for safety — ASCII
 * letters, digits, `:`, `-` and `_`, at most 128 of them — which admits a
 * Vercel id (`lhr1::iad1::…`) and a UUID, and nothing that can carry free text.
 *
 * This module is pure and imports no framework, because `proxy.ts` runs it
 * outside the application's render runtime.
 */

/** The header the id is returned on, and set on the request the app sees. */
export const CORRELATION_ID_HEADER = "x-correlation-id";

/** The header Vercel's edge sets on every request it forwards. */
export const VERCEL_ID_HEADER = "x-vercel-id";

/**
 * What a log line carries when there is no request to correlate with: a build
 * step, a test, or a path the proxy's matcher skips. It is a fixed literal so a
 * log query can tell "no request" from a missing field, and it is refused as
 * an incoming id so a client cannot disguise a request as none.
 */
export const NO_CORRELATION_ID = "none";

const SAFE_CORRELATION_ID = /^[A-Za-z0-9:_-]{1,128}$/;

/** Whether a value may be used as a correlation id as it is. */
export function isSafeCorrelationId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value !== NO_CORRELATION_ID &&
    SAFE_CORRELATION_ID.test(value)
  );
}

/**
 * The id for a request: its `x-vercel-id` when that is well-formed, otherwise
 * a fresh random UUID. A malformed value is dropped, never repeated.
 *
 * **Off Vercel, `x-vercel-id` is just a header a client can send**, which is
 * exactly why it passes the allow-list before it is used. A well-formed
 * forgery can at worst make two log lines share an id; it cannot inject text.
 * An incoming `x-correlation-id` is never read at all.
 */
export function resolveCorrelationId(
  vercelId: string | null,
  generate: () => string = () => globalThis.crypto.randomUUID(),
): string {
  return isSafeCorrelationId(vercelId) ? vercelId : generate();
}
