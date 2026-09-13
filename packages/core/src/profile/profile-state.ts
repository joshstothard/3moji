import type { HandleOwnership } from "../handle/handle-ownership";
import type { Profile } from "../ports/profile-repository";

/**
 * What there is to show behind one Handle, once ownership and the Profile row
 * are put side by side.
 *
 * **Three cases, not five.** `data-model.md` documents that the read answers
 * with a state name so the `Reservation` and the hold expiry never leave
 * `packages/core`; a second union here re-listing `held`, `available` and
 * `reserved` would be that decision written down twice, in two places that can
 * disagree. This union discriminates only the thing the Handle-availability
 * answer cannot: **a claimed Handle with a Profile from a claimed Handle
 * without one.** Everything else collapses into {@link ProfileState.none},
 * which says "there is no Profile to show" and nothing more.
 */
export type ProfileState =
  /** The owner has edited something, and here it is. */
  | { readonly state: "profile"; readonly profile: Profile }
  /**
   * Claimed, and the owner has never edited anything.
   *
   * This is the state the Handle renders large with its Spoken Name
   * (`data-model.md` § Profile). It is a **named** case rather than a Profile
   * of nulls precisely so a caller cannot mistake "never edited" for "edited to
   * be empty", or have to guess which it is looking at.
   */
  | { readonly state: "unedited" }
  /** Nothing to show: not claimed, or claimed by nobody yet. */
  | { readonly state: "none" };

/**
 * Compose a {@link HandleOwnership} verdict with a Profile row into the state a
 * reader may see.
 *
 * **Ownership decides first, and a Profile row cannot overrule it.** A Profile
 * can outlive the Claim that justified showing it — a hold expires lazily, so a
 * row whose `claimed_at` is null and whose `held_until` has passed reads as
 * `available` while it is still sitting in the table (`ownershipOf`), and its
 * Profile is still sitting there too. Returning that Profile would publish a
 * page for a Handle that is back in the pool. Guarding on `claimed` rather than
 * on the row's existence is what makes that unrepresentable, and ADR-0004's
 * rule that a held Handle reveals nothing is the same guard at the other end.
 *
 * Pure, and takes the verdict rather than a `now`: there is one place that
 * reads the clock and one place that interprets a hold, and neither is here.
 */
export function profileStateOf(
  ownership: HandleOwnership,
  profile: Profile | undefined,
): ProfileState {
  if (ownership !== "claimed") return { state: "none" };
  if (profile === undefined) return { state: "unedited" };
  return { state: "profile", profile };
}
