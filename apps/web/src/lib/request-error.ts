import type { Instrumentation } from "next";
import { isHTTPAccessFallbackError } from "next/dist/client/components/http-access-fallback/http-access-fallback";
import { isRedirectError } from "next/dist/client/components/redirect-error";

import { CORRELATION_ID_HEADER } from "./correlation-id";
import { logFailure } from "./log-error";

/**
 * What happens to an error nothing caught (#203).
 *
 * `instrumentation.ts` hands it here from Next.js's `onRequestError`, which
 * runs **on the server**, once for each error Next.js captures while rendering
 * a page, in a route handler, in a server action or in the proxy. That is the
 * error the branded `error.tsx` is shown for, and that page runs in the
 * browser, so this is where it is logged: one `logFailure` line under
 * {@link REQUEST_FAILED_EVENT}, with the request's correlation id and never
 * the message.
 *
 * **Once.** Next.js reports a render error from its React Server Components
 * handler and skips the HTML handler for a digest it has already reported, so a
 * failed request produces one call. Nothing in `src` logs a failure through
 * `logFailure` and then rethrows it, so a boundary's own line is never
 * repeated here: `atBoundary` rethrows without one, and the catches that do
 * log answer instead of throwing.
 *
 * **Not an answer.** `notFound()` and the redirects work by throwing. Next.js
 * does not report them — a spike against 16.3.5 saw no call for a 404, a 308 or
 * a word-alias miss — and they are refused here too, with the same digest
 * checks `atBoundary` uses, so a framework change cannot turn every 404 into a
 * failure line.
 */

/** The `event` of the line, for log-based alerting to key on. */
export const REQUEST_FAILED_EVENT = "request_failed";

type ErroredRequest = Parameters<Instrumentation.onRequestError>[1];

/**
 * The id the proxy put on the request, as Next.js hands it to
 * `onRequestError`. `logFailure` applies the allow-list; a repeated header is
 * not an id at all.
 */
function correlationIdOf(request: ErroredRequest): string | undefined {
  const value = request.headers[CORRELATION_ID_HEADER];
  return typeof value === "string" ? value : undefined;
}

export function reportRequestError(
  error: unknown,
  request: ErroredRequest,
): void {
  if (isRedirectError(error) || isHTTPAccessFallbackError(error)) return;
  logFailure(REQUEST_FAILED_EVENT, error, correlationIdOf(request));
}
