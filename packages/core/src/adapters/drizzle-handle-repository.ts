import { eq } from "drizzle-orm";

import type { DatabaseOrTransaction } from "../db/client";
import { handle } from "../db/handle";
import type { HandleKey } from "../db/handle-key";
import { ownershipOf, type HandleOwnership } from "../handle/handle-ownership";
import type { HandleRepository } from "../ports/handle-repository";

/**
 * {@link HandleRepository} over the `handle` table.
 *
 * It does two things and nothing else: one indexed lookup on the primary key,
 * and {@link ownershipOf} to interpret the row. **The interpretation lives in
 * the domain, not here**, so the hold-expiry rule is unit-testable without a
 * database — which is what ADR-0004's 24-hour hold needs, since a rule only
 * provable against Postgres is a rule nobody exercises on every run.
 *
 * It takes a client **or a transaction**, so the Claim reads availability
 * inside its own transaction through this same adapter rather than a second
 * copy that could interpret a row differently.
 *
 * The lookup is on `key`, which is the primary key under the deterministic `C`
 * collation, so this is an index seek and never a scan.
 */
export function createDrizzleHandleRepository(
  db: DatabaseOrTransaction,
): HandleRepository {
  return {
    async availabilityOf(key: HandleKey, now: Date): Promise<HandleOwnership> {
      const rows = await db
        .select({ heldUntil: handle.heldUntil, claimedAt: handle.claimedAt })
        .from(handle)
        .where(eq(handle.key, key))
        .limit(1);

      return ownershipOf(rows[0], now);
    },
  };
}
