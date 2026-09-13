import {
  profileStateOf,
  toHandleKey,
  type HandleKey,
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

/** No name for anybody, which is a legitimate answer and not a failure. */
const NO_NAMES: ReadonlyMap<string, string> = new Map();

/**
 * The display names behind a listing's rows, in one read
 * ([#109](https://github.com/joshstothard/3moji/issues/109)).
 *
 * **It exists for the bound.** An alias already costs one availability read per
 * candidate — 64 in ADR-0008's worst measured case — and calling
 * {@link readProfile} per row would double that to fetch a bio and a Link list
 * a listing never shows. One batched read keeps the page at N + 1.
 *
 * **It answers keyed on the segment it was asked about**, not on the branded
 * `HandleKey` the query used. The route holds percent-encoded segments and
 * nothing else, so a map keyed on a key would make every lookup at the render a
 * second canonicalisation — and would be one more place the two reads behind a
 * row could come to be about different Handles.
 *
 * **A missing key means "no name to show", and a failed read means the same.**
 * The names decorate the rows; the emoji are the identity. So a refused
 * connection costs the listing its names rather than the whole page, exactly as
 * a failed Profile read leaves the Handle page on its honest line.
 *
 * It says nothing about whether these Handles are claimed. The caller has
 * already asked `readAvailability` that and has filtered on the answer; asking
 * again here would be the second encoding of a rule that lives in the domain.
 *
 * @param segments The percent-encoded emoji segments of the Handles being
 * listed, in the order they are rendered.
 */
export async function readDisplayNames(
  segments: readonly string[],
): Promise<ReadonlyMap<string, string>> {
  const placed: { readonly segment: string; readonly key: HandleKey }[] = [];
  for (const segment of segments) {
    const key = toHandleKey(segment);
    // Unreachable from the route, whose candidates come from the resolver and
    // are canonical by construction. Skipped rather than thrown on: one
    // unplaceable segment must not cost the other rows their names.
    if (key !== undefined) placed.push({ segment, key });
  }

  if (placed.length === 0) return NO_NAMES;

  try {
    const { profiles } = getServices();
    const byKey = await profiles.displayNamesOf(placed.map((one) => one.key));

    const bySegment = new Map<string, string>();
    for (const { segment, key } of placed) {
      const name = byKey.get(key);
      if (name !== undefined) bySegment.set(segment, name);
    }
    return bySegment;
  } catch (error) {
    // Logged for the reason `readProfile` logs its own: a misconfigured
    // deployment or a refused connection is the failure that would otherwise be
    // silent — and here it is silent by design, because the page still renders.
    console.error(
      JSON.stringify({
        event: "display_names_read_failed",
        message: error instanceof Error ? error.message : "unknown error",
      }),
    );
    return NO_NAMES;
  }
}

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
