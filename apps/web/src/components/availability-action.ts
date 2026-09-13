"use server";

import { readAvailability } from "../lib/availability";
import { atBoundary } from "../lib/boundary-log";
import type { AvailabilityState } from "./availability-state";

/**
 * The builder's availability read, as a server action.
 *
 * The `handle` table cannot be reached from a browser, so the read happens
 * here, lazily, when a visitor has actually filled three slots. The read itself
 * — and how it degrades when the database is out of reach — lives in
 * `lib/availability.ts`, because `/[handle]` has to answer the same question
 * about the same segment and the two must not drift apart.
 *
 * **Read-only.** The `HandleRepository` port exposes no writes at all; claiming
 * is [#81](https://github.com/joshstothard/3moji/issues/81), with its own
 * transaction and its own issue.
 *
 * `segment` is typed `unknown` because a server action is a public HTTP
 * endpoint: whatever a client sends arrives here, and TypeScript's word for it
 * is worth nothing at runtime. Anything that is not a string is refused before
 * the domain sees it; anything that is goes to the read, which decodes and
 * validates it exactly as `/[handle]` does.
 */
export async function checkAvailability(
  segment: unknown,
): Promise<AvailabilityState> {
  // One boundary line per call (#156). `"unknown"` from the read means the
  // read failed and degraded (it has already written its `logFailure` line),
  // so it is logged `failed`; every other state is an answer.
  return atBoundary(
    "availability.check",
    async (record) => {
      if (typeof segment !== "string") {
        record("rejected");
        return "unknown";
      }

      return readAvailability(segment);
    },
    { outcomeOf: (state) => (state === "unknown" ? "failed" : "ok") },
  );
}
