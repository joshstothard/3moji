import type { HandleKey } from "../db/handle-key";
import type { Clock } from "../ports/clock";
import type { ReleaseStore } from "../ports/release-store";

/**
 * What a Release did.
 *
 * `no-handle` is an **ordinary answer, not an error** — the same argument
 * `claimHandle` makes about a refused Claim. It means no live Account owns a
 * Handle under this id, which ADR-0004 decision 4 leaves only two ways to
 * reach: an id that names nobody, or a Release that already happened.
 */
export type ReleaseResult =
  | {
      readonly state: "released";
      /** The Handle that went back into the pool, claimable immediately. */
      readonly key: HandleKey;
      readonly releasedAt: Date;
    }
  | { readonly state: "no-handle" };

export interface ReleaseHandleInput {
  /** The Account being deleted. Release and account deletion are one act. */
  readonly userId: string;
  readonly store: ReleaseStore;
  /** The one place time is read on this path. */
  readonly clock: Clock;
}

/**
 * The Release: **account deletion, with a tombstone left behind**.
 *
 * ADR-0004 decision 5 says there is no handle-less Account, so giving up a
 * Handle is deleting the Account — and the Profile and Links of Phase 4 go with
 * it, through the cascade `handle.user_id` already declares on `user`. The
 * interface owes the person that sentence plainly rather than hiding it behind
 * the word "release"; that copy belongs with the account surface, which does
 * not exist yet.
 *
 * [ADR-0009](../../../../docs/adr/0009-release-leaves-a-tombstone-and-the-cooldown-is-dropped-for-the-mvp.md)
 * shapes the rest of it:
 *
 * - **No cooldown** (decision 1). Nothing here holds the Handle back, and
 *   nothing on the claim path consults what this writes — the released Handle
 *   is claimable the instant this commits, by anyone, including the person who
 *   just gave it up.
 * - **A tombstone, in the same transaction** (decision 2). The deletion and the
 *   row are one act: a tombstone for an Account that still exists is a lie, and
 *   a deletion with no tombstone loses a fact that cannot be recreated.
 * - **The key is read first, and that ordering is a rule.** `handle.user_id`
 *   cascades, so the row is gone the moment the Account is — a read placed
 *   after the delete would find nothing and the tombstone would have no key to
 *   carry.
 */
export function releaseHandle(
  input: ReleaseHandleInput,
): Promise<ReleaseResult> {
  return input.store.runInTransaction<ReleaseResult>(async (tx) => {
    const key = await tx.handleOf(input.userId);
    if (key === undefined) {
      // Nothing read, nothing written, and the rollback says so: a Release that
      // found nothing to release must not leave a tombstone for a Handle it
      // cannot name.
      return { commit: false, value: { state: "no-handle" } };
    }

    const releasedAt = input.clock.now();
    await tx.recordRelease({ key, releasedAt });
    await tx.deleteAccount(input.userId);

    return { commit: true, value: { state: "released", key, releasedAt } };
  });
}
