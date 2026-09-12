/**
 * What the `handle` table says about one canonical key, and nothing else.
 *
 * This is the **row's** answer, not the product's: it knows about holds and
 * ownership but nothing about the Reserved Handle list. Composing the two is
 * {@link ../handle/handle-availability.handleAvailability}'s job, because a
 * reservation is a statement about a Handle rather than a property of a row.
 */
export type HandleOwnership = "available" | "held" | "claimed";

/** The two columns that decide ownership. */
export interface HandleHoldRow {
  /** When the hold dies. Never defaulted in SQL — supplied from a `Clock`. */
  readonly heldUntil: Date;
  /**
   * When the Claim became final. **`null` is what "still held" means**, so a
   * row with a past `heldUntil` and a non-null `claimedAt` is owned, not
   * expired.
   */
  readonly claimedAt: Date | null;
}

/**
 * Interpret a row as ownership, at a given instant.
 *
 * **Expiry is read as interpretation, never as a write.** ADR-0004 decision 3
 * expires holds lazily — evaluated when someone next attempts that Handle,
 * with no scheduled sweep — so a hold past `heldUntil` reads as `available`
 * while its row is still sitting there. Freeing the row and deleting the
 * unverified Account belongs to the claim path — `ClaimTransaction.freeExpiredHold`,
 * called from `claimHandle` inside its own transaction — and not here.
 *
 * The write there restates this rule as SQL (`claimed_at IS NULL AND
 * held_until <= now`) rather than trusting this verdict, so a wrong reading
 * here cannot delete an Account. The two encodings must agree on the boundary;
 * an integration test pins the instant itself in both.
 *
 * A hold expires **at** `heldUntil`, not after it: the boundary instant is
 * already expired. Twenty-four hours means twenty-four hours.
 */
export function ownershipOf(
  row: HandleHoldRow | undefined,
  now: Date,
): HandleOwnership {
  if (row === undefined) return "available";
  if (row.claimedAt !== null) return "claimed";
  return row.heldUntil.getTime() > now.getTime() ? "held" : "available";
}
