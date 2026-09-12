"use server";

import { handleAvailability } from "@template/core";
import { getServices } from "../lib/services";
import type { AvailabilityState } from "./availability-state";

/**
 * The builder's availability read, as a server action.
 *
 * The `handle` table cannot be reached from a browser, and it cannot be reached
 * on the home page's render path either: `lib/services.ts` throws unless all
 * five of `DATABASE_URL`, `RESEND_API_KEY`, `RESEND_FROM`, `BETTER_AUTH_URL`
 * and `BETTER_AUTH_SECRET` are set, and a fresh clone has none of them. So the
 * read happens here, lazily, when a visitor has actually filled three slots —
 * and every failure becomes `"unknown"` rather than a rejection that takes the
 * page down with it.
 *
 * **Read-only.** The `HandleRepository` port exposes no writes at all; claiming
 * is [#81](https://github.com/joshstothard/3moji/issues/81), with its own
 * transaction and its own issue.
 *
 * `segment` is typed `unknown` because a server action is a public HTTP
 * endpoint: whatever a client sends arrives here, and TypeScript's word for it
 * is worth nothing at runtime. Anything that is not a string is refused before
 * the domain sees it; anything that is goes to `handleAvailability`, which
 * decodes and validates it exactly as `/[handle]` does.
 */
export async function checkAvailability(
  segment: unknown,
): Promise<AvailabilityState> {
  if (typeof segment !== "string") {
    return "unknown";
  }

  try {
    const { clock, handles } = getServices();
    const result = await handleAvailability({
      segment,
      repository: handles,
      clock,
    });
    return result.state;
  } catch (error) {
    // The one place this path can fail silently is a misconfigured deployment,
    // which is exactly the case worth a log line rather than a shrug.
    console.error(
      JSON.stringify({
        event: "availability_check_failed",
        message: error instanceof Error ? error.message : "unknown error",
      }),
    );
    return "unknown";
  }
}
