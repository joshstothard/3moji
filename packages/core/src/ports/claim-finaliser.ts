import type { HandleKey } from "../db/handle-key";
import type { TransactionOutcome } from "./claim-store";

/**
 * What Better Auth said about the followed link.
 *
 * `signedIn` is false for the second click of a still-valid link, which is an
 * ordinary thing for a person to do — mail clients prefetch, people press back.
 * Better Auth answers that with `user: null` and **no session**: neither a
 * success to celebrate nor a failure to report, and the page has to work for
 * somebody who is not signed in.
 */
export type EmailVerification =
  | {
      readonly ok: true;
      /**
       * The response headers, carrying the session cookie Better Auth set.
       * They have to be forwarded by the transport or
       * `autoSignInAfterVerification` verifies the address and signs nobody in.
       */
      readonly headers: Headers;
      /**
       * Whether a session was issued — measured by the presence of a
       * `Set-Cookie`, which is the sign-in itself rather than a report of one.
       */
      readonly signedIn: boolean;
    }
  | {
      readonly ok: false;
      /** Expired, tampered with, or for an Account that no longer exists. */
      readonly reason: "rejected";
    };

/** Whether the hold became ownership. */
export type HoldFinalised =
  | { readonly ok: true; readonly key: HandleKey }
  | { readonly ok: false; readonly reason: "no-hold" | "hold-expired" };

/**
 * The verification and the finalisation of one Claim, inside one transaction.
 *
 * They are one act for the same reason the Claim itself is: `handle.claimed_at`
 * is what "this Handle is owned" means, and a verified Account whose hold was
 * never finalised owns nothing — its Handle still reads as held and lazy expiry
 * ([#83](https://github.com/joshstothard/3moji/issues/83)) will free it out
 * from under somebody who did everything right. Verifying and finalising in
 * separate statements makes that a matter of luck.
 *
 * Separate from {@link ./claim-store.ClaimStore} rather than two more methods
 * on it: the Claim has no business being able to finalise, and this has no
 * business creating an Account. The adapters share their transaction plumbing,
 * which is where the duplication would otherwise be.
 */
export interface ClaimFinaliserTransaction {
  verifyEmail(token: string): Promise<EmailVerification>;
  /**
   * Fills in `claimed_at`, which is the Claim becoming final.
   *
   * Refuses a hold that has already expired — the row may still be sitting
   * there, since expiry is lazy, and finalising it would resurrect a Handle
   * somebody else is entitled to take. Finalising a hold that is already final
   * is not an error: the second click of a working link reaches it.
   */
  finaliseHold(userId: string, at: Date): Promise<HoldFinalised>;
}

export interface ClaimFinaliser {
  runInTransaction<T>(
    work: (tx: ClaimFinaliserTransaction) => Promise<TransactionOutcome<T>>,
  ): Promise<T>;
}
