import {
  profileStateOf,
  toHandleKey,
  type HandleOwnership,
  type ProfileState,
} from "@template/core";
import { getServices } from "./services";
import type { AvailabilityState } from "../components/availability-state";

/**
 * What there is to show behind a Handle the route has already placed.
 *
 * **It is a second read, and it happens only for a claimed Handle.** The join
 * behind `ProfileRepository.profileOf` deliberately does not say whether a
 * Handle is claimed — that needs an injected `now` and the hold-expiry rule,
 * which live in `ownershipOf` — so the two are composed by the pure
 * `profileStateOf`, and this module is the transport-side wiring of that
 * composition and nothing more. It re-derives neither rule.
 *
 * **Ownership decides first, and the guard is cheaper than a query.** A hold
 * expires lazily, so a Profile row outlives the Claim that justified showing
 * it: the row sits in the table while `ownershipOf` already reads the Handle as
 * back in the pool. `profileStateOf` makes publishing that unrepresentable, and
 * not issuing the query at all makes it unreachable — which is the form ADR-0004
 * wants at the other end too, where a held Handle must reveal neither its holder
 * nor its expiry. The state name is all the route has, and a Profile is the
 * first thing this page renders that is not one.
 *
 * @param segment The same percent-encoded segment `readAvailability` was asked
 * about, so the two answers cannot be about different Handles.
 * @param state What `readAvailability` answered about that segment.
 */
export async function readProfile(
  segment: string,
  state: AvailabilityState,
): Promise<ProfileState> {
  const ownership = ownershipFrom(state);

  if (ownership !== "claimed") {
    // The domain's own answer for "not claimed", rather than a `none` written
    // out here: there is one place that decides what a non-claimed Handle
    // shows, and it is not this file.
    return profileStateOf(ownership, undefined);
  }

  const key = toHandleKey(segment);
  if (key === undefined) {
    // Unreachable from the route, which canonicalised the segment itself and
    // 404'd every rejection before the read. Answered honestly rather than
    // assumed away: there is no key to look up, so there is nothing to show —
    // and `unedited` would be a claim about an owner we cannot even identify.
    return NOTHING_TO_SHOW;
  }

  try {
    const { profiles } = getServices();
    return profileStateOf(ownership, await profiles.profileOf(key));
  } catch (error) {
    // A misconfigured deployment or a refused connection, logged for the reason
    // `readAvailability` logs its own: it is the failure that would otherwise
    // be silent. The answer is **`none`, never `unedited`** — `unedited` is a
    // statement about the owner, and a failed query says nothing about the
    // owner. `none` leaves the route on its honest "This Handle is taken." line.
    console.error(
      JSON.stringify({
        event: "profile_read_failed",
        message: error instanceof Error ? error.message : "unknown error",
      }),
    );
    return NOTHING_TO_SHOW;
  }
}

/** There is no Profile to show, and nothing more is being said. */
const NOTHING_TO_SHOW: ProfileState = { state: "none" };

/**
 * The ownership verdict an availability answer implies.
 *
 * `handleAvailability` consults ownership before the Reserved Handle list, so
 * `claimed` and `held` mean exactly what `ownershipOf` said about the row.
 * Every other answer — `available`, `not-claimable`, `unknown`, `not-a-handle`
 * — is "not somebody's Handle, as far as we can tell", and `available` is the
 * right verdict for all of them here: it is the one that shows nothing, which
 * is what a failed or unplaceable read must show.
 */
function ownershipFrom(state: AvailabilityState): HandleOwnership {
  if (state === "claimed") return "claimed";
  if (state === "held") return "held";
  return "available";
}
