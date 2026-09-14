import type { Instrumentation } from "next";

import { reportRequestError } from "./lib/request-error";

/**
 * Next.js's server-side report of an error nothing caught (#203), logged once
 * through `logFailure` with the request's correlation id.
 *
 * **This file exports `onRequestError` and nothing else.** No `register()`, and
 * no tracing import: tracing would put bound query values on spans, and its
 * decision is still open (#148). `scripts/tracing-guard.test.mjs` fails the
 * build if either appears here.
 */
export const onRequestError: Instrumentation.onRequestError = (
  error,
  request,
) => {
  reportRequestError(error, request);
};
