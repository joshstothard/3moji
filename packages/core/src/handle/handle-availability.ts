import type { Clock } from "../ports/clock";
import type { HandleRepository } from "../ports/handle-repository";
import { handleKeyOf } from "../db/handle-key";
import type { CanonicalHandle, CanonicalisationFailure } from "./canonicalise";
import { canonicalHandleOf, claimableHandle } from "./claimable";
import type { Reservation, ReservedHandleList } from "./reserved-handles";

/**
 * What a visitor or a would-be claimant is told about one segment.
 *
 * Five answers, and the distinctions are the point:
 *
 * - `not-a-handle` is a 404. It carries the unflattened
 *   {@link CanonicalisationFailure}, because its four reasons are four
 *   different responses — a 308 for an odd spelling is not a 404.
 * - `not-claimable` **resolves**. A Reserved Handle is a real, well-formed
 *   Handle that nobody may own, and answering 404 would be a lie.
 * - `claimed` and `not-claimable` are deliberately separate. Collapsing them
 *   into one "unavailable" is [#68](https://github.com/joshstothard/3moji/issues/68)
 *   in another form: the copy differs, and one has a Profile behind it.
 */
export type HandleAvailability =
  | { readonly state: "available"; readonly handle: CanonicalHandle }
  | { readonly state: "held"; readonly handle: CanonicalHandle }
  | { readonly state: "claimed"; readonly handle: CanonicalHandle }
  | {
      readonly state: "not-claimable";
      readonly handle: CanonicalHandle;
      readonly reservation: Reservation;
    }
  | {
      readonly state: "not-a-handle";
      readonly failure: CanonicalisationFailure;
    };

export interface HandleAvailabilityInput {
  /** The received path segment, still percent-encoded, or a raw emoji string. */
  readonly segment: string;
  readonly repository: HandleRepository;
  /** The one place time is read on this path. */
  readonly clock: Clock;
  /**
   * The Reserved Handle list. A parameter so a test can add an entry and prove
   * it affects future Claims only.
   */
  readonly list?: ReservedHandleList;
}

/**
 * Compose the table's answer with the Reserved Handle list.
 *
 * **Ownership is consulted before reservation, and the order is load-bearing.**
 * Reserved additions apply to future Claims only — nothing on the resolve path
 * reads the list, so an Account that already owns a Handle keeps it even if the
 * Handle is reserved afterwards. For a visitor standing in front of such a
 * Handle the truthful answer is `claimed`: there is a Profile to see. Checking
 * the list first would hide a real page behind "nobody may own this".
 *
 * A held Handle is reported as `held` for the same reason, and reveals nothing
 * about who holds it or when the hold expires — ADR-0004 treats a countdown as
 * an information leak and an invitation to wait.
 */
export async function handleAvailability(
  input: HandleAvailabilityInput,
): Promise<HandleAvailability> {
  const claimability = claimableHandle(input.segment, input.list);

  if (!claimability.ok && claimability.reason === "not-a-handle") {
    return { state: "not-a-handle", failure: claimability.failure };
  }

  // A reservation still canonicalised, so re-derive the handle for either
  // branch rather than canonicalising a second time.
  const handle = claimability.ok
    ? claimability.handle
    : canonicalHandleOf(input.segment);

  const ownership = await input.repository.availabilityOf(
    handleKeyOf(handle),
    input.clock.now(),
  );

  if (ownership === "claimed") return { state: "claimed", handle };
  if (ownership === "held") return { state: "held", handle };

  if (!claimability.ok) {
    return {
      state: "not-claimable",
      handle,
      reservation: claimability.reservation,
    };
  }

  return { state: "available", handle };
}
