import type { HandleKey } from "../db/handle-key";
import type { AccountDirectory } from "../ports/account-directory";
import type { ClaimFinaliser } from "../ports/claim-finaliser";
import type { Clock } from "../ports/clock";
import type { VerificationDispatchStore } from "../ports/verification-dispatch-store";
import { verificationTokenFingerprint } from "./verification-token";

/**
 * What following a verification link did.
 *
 * Six answers, and the distinctions are the product:
 *
 * - `claimed` is the happy path, and carries the cookies that sign them in.
 * - `already-claimed` is the second click of a working link. Not an error.
 * - `link-superseded` is an older link after a resend. **The Handle is still
 *   theirs**, which is what the screen has to say.
 * - `link-expired` is the ordinary case, not an edge case: the token lasts an
 *   hour and the hold lasts a day, so somebody back from lunch lands here with
 *   a live Hold. It must never read as "you lost the Handle".
 * - `hold-expired` is the one that genuinely lost it: more than 24 hours passed
 *   and the Handle is free again ([#83](https://github.com/joshstothard/3moji/issues/83)
 *   frees the row; this only reports it).
 * - `link-unknown` is a link we have no record of — a hand-typed token, or one
 *   belonging to an Account that has since been deleted. There is nothing
 *   truthful to say about a Handle, so it carries none.
 */
export type ClaimFinalisation =
  | {
      readonly state: "claimed";
      readonly key: HandleKey;
      /** Better Auth's `Set-Cookie` headers. Forwarding them is the sign-in. */
      readonly headers: Headers;
    }
  | { readonly state: "already-claimed"; readonly key: HandleKey }
  | { readonly state: "link-superseded"; readonly key: HandleKey }
  | { readonly state: "link-expired"; readonly key: HandleKey }
  | { readonly state: "hold-expired"; readonly key: HandleKey }
  | { readonly state: "link-unknown" };

export interface FinaliseClaimInput {
  /** The token from the link, exactly as received. */
  readonly token: string;
  readonly dispatches: VerificationDispatchStore;
  readonly directory: AccountDirectory;
  readonly finaliser: ClaimFinaliser;
  /** The one place time is read on this path. */
  readonly clock: Clock;
}

/**
 * Finalise a Claim from a followed verification link.
 *
 * ## Why the freshness check is here and not in Better Auth
 *
 * Better Auth's verification token is a **signed JWT that it does not store**:
 * `createEmailVerificationToken` signs the address with an hour's expiry and
 * writes no row. So there is nothing for a resend to delete, and every link it
 * has ever signed stays valid until it expires on its own. "Each resend
 * invalidates the previous link" is therefore a rule this function enforces,
 * against our own record of what we issued, or it is not enforced at all.
 *
 * The check is a read and happens **before** the transaction opens, because a
 * superseded link must not verify an address as a side effect of finding out it
 * was superseded.
 *
 * ## Why it is not the raw token being compared
 *
 * The dispatch table stores a SHA-256 of each link, never the link. A stored
 * token is a stored credential; a fingerprint answers "is this the newest one"
 * and nothing else.
 */
export async function finaliseClaim(
  input: FinaliseClaimInput,
): Promise<ClaimFinalisation> {
  if (input.token === "") return { state: "link-unknown" };

  const fingerprint = verificationTokenFingerprint(input.token);
  const dispatch = await input.dispatches.findByTokenHash(fingerprint);
  if (dispatch === undefined) return { state: "link-unknown" };

  const owned = await input.directory.handleOf(dispatch.userId);
  if (owned === undefined) {
    // A link whose Account has no Handle. Unreachable through the product —
    // the Account and the hold are one atomic act — and there is nothing
    // truthful to name, so it gets the answer that names nothing.
    return { state: "link-unknown" };
  }

  const newest = await input.dispatches.newestFor(dispatch.userId);
  if (newest !== undefined && newest.tokenHash !== fingerprint) {
    return { state: "link-superseded", key: owned.key };
  }

  const now = input.clock.now();

  return input.finaliser.runInTransaction<ClaimFinalisation>(async (tx) => {
    const verified = await tx.verifyEmail(input.token);
    if (!verified.ok) {
      // Nothing was written, but roll back anyway rather than commit a
      // transaction whose only statement failed: the rule is that this path
      // either finalises a Claim or changes nothing.
      return {
        commit: false,
        value: { state: "link-expired", key: owned.key },
      };
    }

    const finalised = await tx.finaliseHold(dispatch.userId, now);
    if (!finalised.ok) {
      // The address is verified in this transaction and about to be un-verified
      // by the rollback, which is the right way round: an Account whose hold
      // died is one #83 deletes, and leaving it verified would make it look
      // like a live Account with no Handle — the state ADR-0004 decision 4
      // forbids.
      return {
        commit: false,
        value: {
          state:
            finalised.reason === "hold-expired"
              ? "hold-expired"
              : "link-unknown",
          key: owned.key,
        },
      };
    }

    if (!verified.signedIn) {
      // No session issued, which is Better Auth's answer to the second click of
      // a working link: the address was already verified, so there is nothing
      // to sign in *from*. The page is therefore reached without a session,
      // which is why the verified screen reads its Handle from the path rather
      // than from one. If the hold had somehow never been finalised,
      // `finaliseHold` has just done it, and committing that missing half is
      // exactly right.
      return {
        commit: true,
        value: { state: "already-claimed", key: finalised.key },
      };
    }

    return {
      commit: true,
      value: {
        state: "claimed",
        key: finalised.key,
        headers: verified.headers,
      },
    };
  });
}
