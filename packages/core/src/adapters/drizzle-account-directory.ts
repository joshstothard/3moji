import { eq, sql } from "drizzle-orm";

import type { DatabaseOrTransaction } from "../db/client";
import { withSafeDatabaseErrors } from "../db/database-error";
import { handle } from "../db/handle";
import { user } from "../db/schema";
import type { AccountDirectory } from "../ports/account-directory";

/**
 * {@link AccountDirectory} over `user` and `handle`.
 *
 * **The address lookup is case-insensitive, and that is not a nicety.** Better
 * Auth lower-cases the address into the verification token's payload and finds
 * users by a normalised comparison, so `A@x.com` and `a@x.com` are one Account
 * to it. A directory that compared bytes would report "no such account" for the
 * same person Better Auth is about to mail, which would make the resend limit
 * three-per-spelling and the collision email fire for an address that already
 * exists. `lower(email)` on both sides is the comparison that agrees with the
 * library.
 *
 * That comparison cannot use the `email` unique index, so it is a sequential
 * scan on a small table today. The fix, if it ever matters, is a functional
 * index on `lower(email)` — deliberately not added now: `drizzle-kit` owns this
 * schema, and an index nothing has measured a need for is a migration with no
 * evidence behind it.
 */
export function createDrizzleAccountDirectory(
  db: DatabaseOrTransaction,
): AccountDirectory {
  return {
    async byEmail(email) {
      const rows = await withSafeDatabaseErrors(() =>
        db
          .select({
            userId: user.id,
            email: user.email,
            emailVerified: user.emailVerified,
          })
          .from(user)
          .where(sql`lower(${user.email}) = lower(${email})`)
          .limit(1),
      );
      return rows[0];
    },

    async handleOf(userId) {
      const rows = await withSafeDatabaseErrors(() =>
        db
          .select({
            key: handle.key,
            heldUntil: handle.heldUntil,
            claimedAt: handle.claimedAt,
          })
          .from(handle)
          // `handle.user_id` is UNIQUE — an Account owns at most one Handle
          // (ADR-0004 decision 4) — so this is an index seek returning one row.
          .where(eq(handle.userId, userId))
          .limit(1),
      );
      return rows[0];
    },
  };
}
