import type { BackgroundTasks } from "@template/core";
import { after } from "next/server";

import { logFailure } from "./log-error";
import { currentCorrelationId } from "./request-context";

/** How a callback is handed to the platform, to run after the response. */
export type ScheduleAfterResponse = (callback: () => Promise<void>) => void;

/**
 * {@link BackgroundTasks} over Next.js's `after()`
 * ([#216](https://github.com/joshstothard/3moji/issues/216)).
 *
 * `after()` runs a callback once the response has been sent — on Vercel under
 * `waitUntil`, within the function's maximum duration — so work handed to it
 * can neither delay the response nor change it. Every email the domain sends
 * goes through here, which is what keeps a registered address's answer as
 * fast, and as successful, as an unregistered one's.
 *
 * Three rules:
 *
 * 1. **The correlation id is read when the task is scheduled**, inside the
 *    request, and handed to `logFailure` explicitly. `after()` does preserve
 *    the request's async context today, but relying on that would stack a
 *    second Next.js internal on the one `currentCorrelationId` already rests
 *    on. Captured first, the log line depends on neither.
 * 2. **Nothing a task throws reaches `after()`.** Next.js prints a failed
 *    callback's raw error with `console.error`, and a provider's message can
 *    quote the address. So a failure is logged here, once, through
 *    `logFailure`, which writes no message (#134).
 * 3. **If `after()` refuses** — it throws outside a request scope — the task
 *    still runs, detached, with the same catch. Nothing is waiting on a
 *    response then, and a send that silently never happened would be worse.
 */
export function createAfterBackgroundTasks(
  schedule: ScheduleAfterResponse = after,
): BackgroundTasks {
  return {
    run: (event, task) => {
      const correlationId = currentCorrelationId();

      const guarded = async (): Promise<void> => {
        try {
          await task();
        } catch (error) {
          logFailure(event, error, correlationId);
        }
      };

      try {
        schedule(guarded);
      } catch {
        void guarded();
      }
    },
  };
}
