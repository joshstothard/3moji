import { headers } from "next/headers";
import { workUnitAsyncStorage } from "next/dist/server/app-render/work-unit-async-storage.external";

import {
  CORRELATION_ID_HEADER,
  isSafeCorrelationId,
  NO_CORRELATION_ID,
} from "./correlation-id";

/**
 * How code inside a request reads the correlation id `proxy.ts` set (#155).
 *
 * The proxy runs as a separate invocation, so the only thing it can hand the
 * application is the request itself: it sets `x-correlation-id` on the request
 * headers, and these read it back. **Both re-apply the allow-list.** The
 * proxy's matcher skips static assets, and on a skipped path a client-sent
 * `x-correlation-id` would arrive untouched — so an id is only ever returned
 * after passing `isSafeCorrelationId`, and anything else reads as
 * {@link NO_CORRELATION_ID}.
 *
 * Neither ever throws or rejects: both are called from catch blocks, and from
 * places that may run with no request at all (a build step, a test).
 */

/**
 * The correlation id of the current request, through `headers()`.
 *
 * **This is the one to call from a route handler or server action** (#156).
 * It uses only the documented API, so it is the reader to reach for anywhere
 * that can await.
 */
export async function readCorrelationId(): Promise<string> {
  try {
    const value = (await headers()).get(CORRELATION_ID_HEADER);
    return isSafeCorrelationId(value) ? value : NO_CORRELATION_ID;
  } catch {
    return NO_CORRELATION_ID;
  }
}

/**
 * The id held by a Next.js work-unit store, or the sentinel. Exported so the
 * narrowing is tested on its own; `currentCorrelationId` is the caller.
 */
export function correlationIdOfStore(store: unknown): string {
  try {
    if (
      typeof store !== "object" ||
      store === null ||
      !("type" in store) ||
      store.type !== "request" ||
      !("headers" in store) ||
      !(store.headers instanceof Headers)
    ) {
      return NO_CORRELATION_ID;
    }
    const value = store.headers.get(CORRELATION_ID_HEADER);
    return isSafeCorrelationId(value) ? value : NO_CORRELATION_ID;
  } catch {
    return NO_CORRELATION_ID;
  }
}

/**
 * The correlation id of the current request, **synchronously**.
 *
 * This exists for `logFailure`, which is synchronous and must stay so: its
 * callers log inside catch blocks, and their suites inspect the console as
 * soon as the awaited action returns. `headers()` is a promise in Next.js 16,
 * and calling it from a logger would also count as dynamic data access in a
 * page that is being prerendered.
 *
 * So this reads the same per-request store `headers()` reads, directly.
 * **That store is a Next.js internal** (`work-unit-async-storage.external`,
 * which Next.js keeps outside every bundle so there is one instance per
 * process). `request-context.test.ts` runs code inside the real store and
 * asserts the id comes back, so an upgrade that moves or reshapes it fails the
 * build instead of quietly turning every log line's id into the sentinel.
 * Anything that can await should call {@link readCorrelationId} instead.
 */
export function currentCorrelationId(): string {
  try {
    return correlationIdOfStore(workUnitAsyncStorage.getStore());
  } catch {
    return NO_CORRELATION_ID;
  }
}
