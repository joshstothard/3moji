import { eq } from "drizzle-orm";

import type { Database, DatabaseOrTransaction } from "../db/client";
import { toSafeDatabaseError } from "../db/database-error";
import { link } from "../db/link";
import { profile } from "../db/profile";
import type { TransactionOutcome } from "../ports/claim-store";
import type {
  ProfileLinkToWrite,
  ProfileStore,
  ProfileToWrite,
  ProfileTransaction,
} from "../ports/profile-store";

/**
 * Rolls the transaction back and carries nothing — the device
 * `drizzle-release-store.ts` uses, for the same reason: Drizzle commits when
 * the callback returns and rolls back when it throws, so a rejected unit of
 * work has to throw *something* while the verdict is held outside in the
 * {@link TransactionOutcome}.
 */
class ProfileEditRolledBack extends Error {
  constructor() {
    super("the profile edit transaction was rolled back by the domain");
    this.name = "ProfileEditRolledBack";
  }
}

export interface DrizzleProfileStoreInput {
  readonly db: Database;
  /** Where a Link row's id comes from. Injected so a test can pin it. */
  readonly newId?: () => string;
}

/**
 * {@link ProfileStore} over `profile` and `link`, in one transaction.
 *
 * A plain transaction, not `runWithTransactionalAuth`: an edit writes no Better
 * Auth row and sends no email, so there is nothing to rebind and nothing to
 * defer — the same judgement `createDrizzleReleaseStore` makes.
 */
export function createDrizzleProfileStore(
  input: DrizzleProfileStoreInput,
): ProfileStore {
  const newId = input.newId ?? (() => crypto.randomUUID());

  return {
    async runInTransaction<T>(
      work: (tx: ProfileTransaction) => Promise<TransactionOutcome<T>>,
    ): Promise<T> {
      let outcome: TransactionOutcome<T> | undefined;

      try {
        await input.db.transaction(async (tx) => {
          outcome = await work(profileTransactionOn(tx, newId));
          if (!outcome.commit) {
            throw new ProfileEditRolledBack();
          }
        });
      } catch (error) {
        if (!(error instanceof ProfileEditRolledBack)) {
          // Without the Profile's text, which drizzle repeats as the
          // statement's parameters, and with the SQLSTATE kept (#144).
          throw toSafeDatabaseError(error);
        }
      }

      if (outcome === undefined) {
        throw new Error(
          "the profile edit transaction ended without a verdict. The callback must return a TransactionOutcome.",
        );
      }

      return outcome.value;
    },
  };
}

/** A `link` row, as {@link linkRowsFor} builds one. */
export interface LinkRowToInsert {
  readonly id: string;
  readonly userId: string;
  readonly title: string;
  readonly url: string;
  readonly position: number;
}

/**
 * The submitted list as `link` rows: **`position` is the array index**.
 *
 * Pure, and separate from the write, because this is the whole of the
 * translation from "the order the owner set" to the column a read orders by —
 * and this project has no local Postgres, so a mapping left inside the
 * statement would be a mapping nobody exercises on every run. The same split
 * `profileFromRows` makes on the way back out.
 *
 * Positions are dense from `0`, which is what keeps them inside
 * `link_position_within_limit` (`0 <= position < LINK_LIMIT`): an eleventh Link
 * is refused by the `CHECK` rather than by a count this code has to remember to
 * take.
 */
export function linkRowsFor(
  userId: string,
  links: readonly ProfileLinkToWrite[],
  newId: () => string,
): readonly LinkRowToInsert[] {
  return links.map((entry, position) => ({
    id: newId(),
    userId,
    title: entry.title,
    url: entry.url,
    position,
  }));
}

/**
 * The writes of one edit, bound to one transaction.
 *
 * **Exported for its own tests, not for callers** — the same note
 * `releaseTransactionOn` carries. In production it is reached only from
 * {@link createDrizzleProfileStore}, and `ProfileStore` is what the domain
 * depends on.
 */
export function profileTransactionOn(
  tx: DatabaseOrTransaction,
  newId: () => string = () => crypto.randomUUID(),
): ProfileTransaction {
  return {
    /**
     * Upsert the row, then **replace the Link list entire**.
     *
     * Three statements in one fixed order, and each of the three orderings
     * matters:
     *
     * - **The Profile row first**, because `link.user_id` references
     *   `profile.user_id`: an insert before the row exists is a foreign-key
     *   violation on a Profile's very first edit.
     * - **Delete before insert, rather than updating in place.** `UNIQUE
     *   (user_id, position)` makes an in-place rewrite collide with itself the
     *   moment two Links swap places, and a list of at most ten rows inside a
     *   transaction is not worth an ordering dance to avoid. Deleting the ones
     *   that survive and re-inserting them means their `id`s change, which is
     *   sound only because nothing references a Link — nothing does, and
     *   `link.id` exists so a *position* need not be a key.
     * - **`updated_at` comes from the caller**, never `defaultNow()`:
     *   `src/db/profile.ts` says so, because it is a value the domain reasons
     *   about and a SQL default puts it where no test can move time.
     */
    async saveProfile(input: ProfileToWrite): Promise<void> {
      await tx
        .insert(profile)
        .values({
          userId: input.userId,
          displayName: input.displayName,
          bio: input.bio,
          updatedAt: input.updatedAt,
        })
        .onConflictDoUpdate({
          target: profile.userId,
          // `created_at` is deliberately absent: it is when the Profile
          // appeared, and an edit is not an appearance.
          set: {
            displayName: input.displayName,
            bio: input.bio,
            updatedAt: input.updatedAt,
          },
        });

      await tx.delete(link).where(eq(link.userId, input.userId));

      const rows = linkRowsFor(input.userId, input.links, newId);
      if (rows.length === 0) {
        // Drizzle rejects an empty `values([])`, and "the owner removed every
        // Link" is an ordinary edit rather than an edge case. The delete above
        // has already made the table say it.
        return;
      }
      await tx.insert(link).values(rows.map((row) => ({ ...row })));
    },
  };
}
