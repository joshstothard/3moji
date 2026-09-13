import type { Metadata } from "next";
import { notFound } from "next/navigation";

import {
  isTestErrorRouteEnabled,
  TEST_ERROR_MESSAGE,
} from "../../lib/test-error-route";

/**
 * A page that throws, for CI's E2E job only (#203).
 *
 * It lets `accessibility.spec.ts` and `error-pages.spec.ts` render the branded
 * error page from a real server error, in both Playwright projects. **Without
 * `TEST_ERROR_ROUTE=enabled`, and on every deployment whatever that says, it is
 * `notFound()`** — the same 404 `/test-only-error` answered before this file
 * existed, when `[handle]` refused it as neither a Handle nor a word alias.
 */

/** Read the switch per request; a build must never freeze either answer. */
export const dynamic = "force-dynamic";

export const metadata: Metadata = { robots: { index: false, follow: false } };

export default function TestOnlyErrorPage(): never {
  if (!isTestErrorRouteEnabled(process.env)) notFound();
  throw new Error(TEST_ERROR_MESSAGE);
}
