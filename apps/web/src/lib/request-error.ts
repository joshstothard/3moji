import type { Instrumentation } from "next";
import { isHTTPAccessFallbackError } from "next/dist/client/components/http-access-fallback/http-access-fallback";
import { isRedirectError } from "next/dist/client/components/redirect-error";

import { CORRELATION_ID_HEADER } from "./correlation-id";
import { logFailure } from "./log-error";

/**
 * What happens to an error nothing caught (#203).
 *
 * The branded `error.tsx` runs in the browser, so it cannot log on the server.
 * Next.js's own server-side report of the same error is `onRequestError`,
 * which `apps/web/src/instrumentation.ts` exports and which calls this. It is
 * called once per failed request, inside the request, and not for a 404, a 308
 * or a redirect: `e2e/request-error-log.spec.ts` asserts that on the server's
 * own output.
 *
 * **That file exports `onRequestError` and nothing else.** No `register()` and
 * no tracing import: the tracing decision in `AGENTS.md` § Observability (#148)
 * is still open, and `scripts/tracing-guard.test.mjs` fails the build if an
 * instrumentation file exports anything else or imports a tracing module.
 *
 * What it does: one `logFailure` line under {@link REQUEST_FAILED_EVENT},
 * carrying the correlation id from the request's `x-correlation-id` header —
 * which `logFailure` checks against the allow-list, reading the request store
 * when there is none and writing `"none"` for one that fails — and never the
 * message. `notFound()` and the redirects work by throwing, and are refused
 * with the digest checks `atBoundary` uses, so a framework change cannot turn
 * every 404 into a failure line.
 */

/** The `event` of the line, for log-based alerting to key on. */
export const REQUEST_FAILED_EVENT = "request_failed";

type ErroredRequest = Parameters<Instrumentation.onRequestError>[1];

/**
 * The id the proxy put on the request, as Next.js hands it to
 * `onRequestError`. A repeated header is not an id at all.
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
