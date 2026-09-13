import { notifyExistingOwner } from "../auth/claim-collision";
import type { EmailSender } from "../auth/ports/email-sender";
import { realSleep, withResponseFloor } from "../auth/response-floor";
import type { AccountDirectory } from "../ports/account-directory";
import type { CanonicalHandle, CanonicalisationFailure } from "./canonicalise";
import {
  claimHandle,
  type ClaimHandleInput,
  type ClaimResult,
} from "./claim-handle";
import type { ClaimRateLimiter } from "./claim-rate-limit";
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
    }
  | {
      /**
       * Too many submissions from this client address, or naming this email
       * address, in the window ([#157](https://github.com/joshstothard/3moji/issues/157)).
       *
       * **Which of the two is deliberately absent**, and so is any "try again
       * in": either would tell a caller which limit bound, and the email limit
       * binding is a fact about an address. It says nothing about whether the
       * address is registered, because the limit counts submissions and never
       * Accounts.
       */
      readonly state: "rate-limited";
    };

export interface SubmitClaimInput extends ClaimHandleInput {
  /** Reads the existing owner's Handle, for the collision email. */
  readonly directory: AccountDirectory;
  /**
   * Sends that email, after the answer (#216). Not the transaction's deferring
   * sender: the transaction is over.
   */
  readonly emailSender: EmailSender;
  /** Where the collision email points: the reset **form**. */
  readonly resetRequestUrl: string;
  /** The verified sender address. */
  readonly from: string;
  /**
   * The rate limit, consulted before anything else. Required, so no transport
   * can reach the Claim without it (#157).
   */
  readonly rateLimiter: ClaimRateLimiter;
  /**
   * The client's network address as the transport read it from the forwarded
   * headers, or `undefined`. Validated by the limiter, not trusted.
   */
  readonly clientAddress: string | undefined;
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
 *    hashes a password and inserts two rows; a collision does one `SELECT` and
 *    rolls back, which is *much* faster. Neither sends mail inside the floor:
 *    both emails go out after the answer (#216), so a slow or failing
 *    provider cannot tell them apart either. So the fast branch is
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
 * **The rate limit comes first, inside the floor** (#157). A submission over
 * either limit is refused before the Claim's transaction opens, so it creates
 * nothing and mails nobody — which is what bounds the collision notices one
 * inbox can receive. Its answer is padded like the answers about an address,
 * so a refusal cannot be told from an accepted Claim, or one limit from the
 * other, by how long it took. A limiter that cannot count throws, and the
 * floor pads that too: the Claim fails closed.
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
    async (): Promise<ClaimResult | { readonly state: "rate-limited" }> => {
      const admission = await input.rateLimiter.admit({
        clientAddress: input.clientAddress,
        email: input.email,
      });
      if (admission === "rate-limited") {
        return { state: "rate-limited" };
      }

      const claim = await claimHandle(input);

      if (claim.state === "already-registered") {
        await notifyExistingOwner({
          // The address the Claim collided on, already normalised by it — not
          // the typed one, and not normalised a second time here (#163).
          email: claim.email,
          directory: input.directory,
          emailSender: input.emailSender,
          resetRequestUrl: input.resetRequestUrl,
          from: input.from,
        });
      }

      return claim;
    },
    // The answers that turn on an address: whether it exists, and whether it
    // has been named too often.
    (claim) =>
      claim.state === "held" ||
      claim.state === "already-registered" ||
      claim.state === "rate-limited",
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
    case "rate-limited":
      return { state: "rate-limited" };
  }
}
