import type { HandleKey } from "../db/handle-key";
import type { HandleOwnership } from "../handle/handle-ownership";

/**
 * What the domain needs to know from the `handle` table.
 *
 * **`now` is a parameter, not a `Clock` the adapter owns.** Time is injected
 * once, in the use case above this port, so there is a single place that reads
 * the clock and a fake repository in a test cannot disagree with it about what
 * "now" is.
 *
 * Read-only on purpose. Claiming, expiring and releasing are writes with their
 * own transactions and their own issues; a port that could do both would let a
 * caller write without one.
 */
export interface HandleRepository {
  /**
   * What the table says about this key at `now`. A key with no row is
   * `available`, which is the same answer as an expired hold — deliberately,
   * because to a would-be claimant they are the same thing.
   */
  availabilityOf(key: HandleKey, now: Date): Promise<HandleOwnership>;
}
