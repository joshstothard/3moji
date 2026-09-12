import { notifyExistingOwner } from "../auth/claim-collision";
import type { EmailSender } from "../auth/ports/email-sender";
import { realSleep, withResponseFloor } from "../auth/response-floor";
import type { AccountDirectory } from "../ports/account-directory";
import type { CanonicalHandle, CanonicalisationFailure } from "./canonicalise";
import { claimHandle, type ClaimHandleInput } from "./claim-handle";
import type { Reservation } from "./reserved-handles";

/**
 * What a Claim submission is told — **and `already-registered` is not on it**.
 *
 * {@link claimHandle} answers `already-registered` because a layer that lies to
 * itself cannot be tested. This is the layer where the promise is kept: an
 * address that already has an Account produces `pending`, byte for byte the
 * same answer a fresh sign-up produces, so nothing a caller can observe
 * distinguishes them ([#15](https://github.com/joshstothard/3moji/issues/15)).
 *
 * The collapse happens **here rather than in the transport** on purpose. There
 * are three transports that could reach the Claim — a server action, a route
 * handler, a future API — and a promise kept separately in each is a promise
 * one of them will eventually break. Here, there is no `already-registered`
 * left to leak: the type does not have the case.
 */
export type ClaimSubmission =
  | {
      /**
       * The Handle is held and a verification link is on its way — *or* the
       * address already had an Account and its owner has been told. Which of
       * those happened is deliberately not recoverable from this value.
       */
      readonly state: "pending";
      readonly handle: CanonicalHandle;
    }
  | {
      readonly state: "taken";
      readonly handle: CanonicalHandle;
      readonly because: "held" | "claimed" | "write-rejected";
    }
  | {
      readonly state: "not-claimable";
      readonly handle: CanonicalHandle;
      readonly reservation: Reservation;
    }
  | {
      readonly state: "not-a-handle";
      readonly failure: CanonicalisationFailure;
    };

export interface SubmitClaimInput extends ClaimHandleInput {
  /** Reads the existing owner's Handle, for the collision email. */
  readonly directory: AccountDirectory;
  /** Sends that email. Not the deferring sender: the transaction is over. */
  readonly emailSender: EmailSender;
  /** Where the collision email points: the reset **form**. */
  readonly resetRequestUrl: string;
  /** The verified sender address. */
  readonly from: string;
  /** Injected so a test proves the timing floor without waiting for it. */
  readonly sleep?: (ms: number) => Promise<void>;
  readonly floorMs?: number;
}

/**
 * Submit a Claim, and keep the non-enumeration promise while doing it.
 *
 * Two halves, and both are needed for the promise to be real:
 *
 * 1. **The answer does not vary.** An already-registered address gets
 *    `pending`, the same as a new sign-up, so the hold screen is the same
 *    screen. The transport has nothing to decide.
 * 2. **The time it takes does not vary either.** A body that says nothing while
 *    the response time says everything is not a promise kept. A fresh Claim
 *    hashes a password, inserts two rows and sends mail; a collision does one
 *    `SELECT` and rolls back, which is *much* faster. So the fast branch is
 *    held back to {@link ../auth/response-floor.RESPONSE_FLOOR_MS}, the figure
 *    Better Auth uses on its own unauthenticated email endpoints.
 *
 * The floor is a mitigation and not a proof: a password hash can outlast it, so
 * a determined attacker with many samples could still see a difference. The
 * other half of that is in the claim adapter, which hashes the submitted
 * password even when it has already decided the address is taken — the same
 * dummy-work trick Better Auth's own sign-in uses. Between the two, the
 * remaining signal is small rather than absent, and the honest word for it is
 * mitigated.
 *
 * **A rejected Handle is not padded.** `taken`, `not-claimable` and
 * `not-a-handle` are answers about a *Handle*, which is public information — the
 * builder shows availability live, so there is nothing to conceal and no reason
 * to make the page feel slow.
 */
export async function submitClaim(
  input: SubmitClaimInput,
): Promise<ClaimSubmission> {
  const sleep = input.sleep ?? realSleep;

  const floor = {
    clock: input.clock,
    sleep,
    ...(input.floorMs === undefined ? {} : { floorMs: input.floorMs }),
  };

  const result = await withResponseFloor(
    floor,
    async () => {
      const claim = await claimHandle(input);

      if (claim.state === "already-registered") {
        await notifyExistingOwner({
          email: input.email,
          directory: input.directory,
          emailSender: input.emailSender,
          resetRequestUrl: input.resetRequestUrl,
          from: input.from,
        });
      }

      return claim;
    },
    // Only the two answers that turn on whether the address exists.
    (claim) => claim.state === "held" || claim.state === "already-registered",
  );

  switch (result.state) {
    case "held":
    case "already-registered":
      return { state: "pending", handle: result.handle };
    case "taken":
      return {
        state: "taken",
        handle: result.handle,
        because: result.because,
      };
    case "not-claimable":
      return {
        state: "not-claimable",
        handle: result.handle,
        reservation: result.reservation,
      };
    case "not-a-handle":
      return { state: "not-a-handle", failure: result.failure };
  }
}
