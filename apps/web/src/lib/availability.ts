import { claimableHandle, handleAvailability } from "@template/core";
import { getServices } from "./services";
import type { AvailabilityState } from "../components/availability-state";

/**
 * The application's one availability read, shared by the builder's server
 * action and the `/[handle]` route.
 *
 * Both surfaces answer the same question about the same segment, and both have
 * to answer it on a machine where the database is out of reach: `services.ts`
 * throws unless all five of `DATABASE_URL`, `RESEND_API_KEY`, `RESEND_FROM`,
 * `BETTER_AUTH_URL` and `BETTER_AUTH_SECRET` are set, a fresh clone has none of
 * them, and CI's E2E job sets one. So the read degrades rather than rejecting —
 * and **it degrades to the pure domain's answer, not to a shrug.**
 *
 * That distinction is the whole of
 * [#68](https://github.com/joshstothard/3moji/issues/68). `claimableHandle`
 * needs no database: it canonicalises and applies the Reserved Handle list, so
 * "nobody may ever own this" is answerable at zero I/O cost. Only the three
 * ownership-dependent answers — available, held, claimed — are indistinguishable
 * without the `handle` table, and those become `"unknown"`. Guessing
 * `"available"` there is exactly the lie #68 was filed about.
 *
 * The answer is a **state name and nothing else** (see `AvailabilityState`).
 * There is deliberately no field for a holder or an expiry: ADR-0004 treats a
 * countdown as an information leak and an invitation to wait, and a string
 * union cannot carry one.
 *
 * @param segment A path segment as Next.js gives it — still percent-encoded —
 * or a raw emoji string. The domain decodes and validates it.
 */
export async function readAvailability(
  segment: string,
): Promise<AvailabilityState> {
  try {
    const { clock, handles } = getServices();
    const result = await handleAvailability({
      segment,
      repository: handles,
      clock,
    });
    return result.state;
  } catch (error) {
    // A misconfigured deployment is the one case that would otherwise fail
    // silently, so it is worth a log line rather than a shrug.
    console.error(
      JSON.stringify({
        event: "availability_check_failed",
        message: error instanceof Error ? error.message : "unknown error",
      }),
    );
    return withoutDatabase(segment);
  }
}

/**
 * What is still true with no database: whether this is a Handle at all, and
 * whether anybody may ever own it.
 *
 * Total by construction — `claimableHandle` returns a result for every input
 * rather than throwing, which is why the fallback cannot fail in turn.
 */
function withoutDatabase(segment: string): AvailabilityState {
  const claimability = claimableHandle(segment);
  if (claimability.ok) {
    return "unknown";
  }
  return claimability.reason === "not-a-handle"
    ? "not-a-handle"
    : "not-claimable";
}
