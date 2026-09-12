import {
  canonicalise,
  type CanonicalHandle,
  type CanonicalisationFailure,
} from "./canonicalise";
import {
  RESERVED_HANDLES,
  reservationOf,
  type Reservation,
  type ReservedHandleList,
} from "./reserved-handles";

/** A Handle an Account may Claim. */
export interface ClaimableHandle {
  readonly ok: true;
  /**
   * The full canonicalisation result, not just the key. A route needs
   * `encoded` for its redirect and the three Emoji Set entries for its Spoken
   * Name, and `handleKeyOf` turns this into the branded key the write path
   * takes.
   */
  readonly handle: CanonicalHandle;
}

/** Why a segment may not be Claimed. */
export type ClaimabilityFailure =
  | {
      readonly ok: false;
      readonly reason: "not-a-handle";
      /**
       * The canonicalisation failure, passed through **unflattened**. Its four
       * reasons are four different responses — a 404, a 308, "not claimable
       * yet" — and collapsing them into one "invalid" would throw that away.
       */
      readonly failure: CanonicalisationFailure;
    }
  | {
      readonly ok: false;
      readonly reason: "reserved";
      readonly reservation: Reservation;
    };

export type ClaimabilityResult = ClaimableHandle | ClaimabilityFailure;

/**
 * **ADR-0004 decision 7's first layer: the domain layer, before any write.**
 *
 * The single gate a Claim passes through. It canonicalises, then applies the
 * Reserved Handle list to the canonical key — in that order, because a
 * reservation is a statement about a Handle, and something that is not a
 * Handle has nothing to reserve. An unreleased blocked emoji therefore comes
 * back as `unreleased-category`, not as `reserved`: 🖕 is unclaimable today for
 * a reason that has nothing to do with this list, and saying "reserved" would
 * imply the list is what is holding it.
 *
 * It returns a result rather than throwing, for the reason `canonicalise` does:
 * every rejection here is an ordinary answer to a public request.
 *
 * ## The three layers, and which exist today
 *
 * | Layer | Where | Status |
 * | --- | --- | --- |
 * | Domain, before any write | **this function** | built |
 * | Re-check inside the claim transaction | the claim use case | **deferred to Phase 3** |
 * | Database constraint | `handle_key_no_blocked_emoji` in `src/db/handle.ts` | built |
 *
 * **The middle layer is not built, and is not pretended to be.** There is no
 * claim path yet — it is Phase 3 — and a transaction wrapper with nothing
 * calling it would be a third layer on paper only. This doc comment is the
 * seam instead: **the claim transaction must call {@link claimableHandle}, or
 * at minimum `reservationOf`, on the canonical key inside its own transaction**
 * before inserting, so a list read before the transaction opened cannot be
 * stale by the time the row is written. The database CHECK is what decides a
 * genuine race in the meantime.
 *
 * Never middleware alone, per ADR-0004 decision 7 and the defence-in-depth rule
 * in the engineering standards. Middleware is not one of the three.
 *
 * @param segment The received path segment as Next.js gives it — still
 * percent-encoded — or a raw emoji string from a claim form.
 * @param list The Reserved Handle list. Defaults to the shipped one; a
 * parameter so a test can prove an addition affects future Claims only.
 */
export function claimableHandle(
  segment: string,
  list: ReservedHandleList = RESERVED_HANDLES,
): ClaimabilityResult {
  const result = canonicalise(segment);
  if (!result.ok) {
    return { ok: false, reason: "not-a-handle", failure: result };
  }

  const reservation = reservationOf(result.key, list);
  if (reservation !== undefined) {
    return { ok: false, reason: "reserved", reservation };
  }

  return { ok: true, handle: result };
}
