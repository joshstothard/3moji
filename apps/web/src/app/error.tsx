"use client";

import { ErrorNotice } from "../components/error-notice";

/**
 * The branded error page (#203): what Next.js renders, inside the root layout,
 * when a page or nested layout throws.
 *
 * Next.js requires this to be a client component. It receives the thrown
 * `error` as well as `retry`, and deliberately reads only `retry` — see
 * `ErrorNotice` for why the error goes no further, and `instrumentation.ts`
 * for where it is logged instead.
 */
export default function ErrorPage({
  retry,
}: {
  readonly error: Error & { readonly digest?: string };
  readonly retry: () => void;
}) {
  return <ErrorNotice retry={retry} />;
}
