import type { AccountDirectory } from "../ports/account-directory";
import type { Clock } from "../ports/clock";
import type { VerificationDispatchStore } from "../ports/verification-dispatch-store";
import {
  RESEND_LIMITS,
  resendAllowance,
  type ResendLimits,
} from "./resend-allowance";
import type { ResendClientRateLimiter } from "./resend-rate-limit";
import { realSleep, withResponseFloor } from "./response-floor";

/**
 * What a resend request is told.
 *
 * **`sent` does not mean an email went out.** It means the request was accepted
 * and nothing more is owed to the caller. An unknown address, an address that
 * is already verified, and a genuine unverified Account all produce `sent`,
 * because the alternative is an endpoint that answers the question "does this
 * address have an unverified account here" for anyone who asks.
 *
 * The two refusals do reveal something — that this address has been mailed
 * recently — which is why reaching them requires already knowing the address,
 * and why the *fast* path out of here is padded to the same floor as the slow
 * one. Showing a real refusal is the deliberate trade: telling a user who is
 * waiting on an email "you may try again in 40 seconds" is worth more than the
 * residual signal, and lying to them with `sent` would be worse.
 */
export type ResendOutcome =
  | { readonly state: "sent" }
  | { readonly state: "too-soon"; readonly retryAfterMs: number }
  | { readonly state: "too-many"; readonly retryAfterMs: number };

/** The one thing this use case needs from Better Auth. */
export interface VerificationMailer {
  /**
   * Issues a fresh verification link and sends it.
   *
   * Better Auth's `/send-verification-email`, narrowed to the two facts we use.
   * A port rather than the auth instance, so the use case is testable without
   * standing up Better Auth, and so the rate limit is provably *in front of*
   * the send rather than beside it.
   */
  send(email: string): Promise<void>;
}

export interface ResendVerificationInput {
  /** The address as typed. Never trusted, never used as an identity. */
  readonly email: string;
  /**
   * The client's network address as the transport read it from the forwarded
   * headers, or `undefined`. Not trusted: the limiter validates and groups it.
   */
  readonly clientAddress: string | undefined;
  /** The per-client-address limit (#158), asked before anything else. */
  readonly clientLimiter: ResendClientRateLimiter;
  readonly directory: AccountDirectory;
  readonly dispatches: VerificationDispatchStore;
  readonly mailer: VerificationMailer;
  readonly clock: Clock;
  readonly limits?: ResendLimits;
  /** Injected so a test proves the timing floor without waiting for it. */
  readonly sleep?: (ms: number) => Promise<void>;
  readonly floorMs?: number;
}

/**
 * Send a fresh verification link, within the limits.
 *
 * The order of the three steps is the whole design:
 *
 * 1. **Resolve the address to an Account.** The limit is *per Account*, which
 *    an address cannot stand in for: `A@x.com` and `a@x.com` are one Account,
 *    and a limit keyed on the typed string would be three sends per spelling.
 * 2. **Ask the limit.** Before the send, never after — a limit consulted
 *    afterwards is a log line.
 * 3. **Send, and let the link be recorded.** The dispatch row is written by the
 *    `sendVerificationEmail` hook inside {@link ./create-auth.createAuth},
 *    because that is the one place Better Auth reveals the token it signed.
 *    This use case therefore never records anything itself, and cannot issue a
 *    link that goes unrecorded — which is what makes "the newest link is the
 *    only valid one" true rather than intended.
 *
 * An address with no Account, or one already verified, takes the same path as a
 * real one minus the send: no row is read for a limit that cannot apply, and
 * the answer is `sent`. Better Auth's own endpoint behaves identically, and
 * calling it for those addresses too would be honest but pointless — it would
 * sign a token for nobody.
 */
export async function resendVerification(
  input: ResendVerificationInput,
): Promise<ResendOutcome> {
  const sleep = input.sleep ?? realSleep;
  const floor = {
    clock: input.clock,
    sleep,
    ...(input.floorMs === undefined ? {} : { floorMs: input.floorMs }),
  };

  return withResponseFloor(floor, async (): Promise<ResendOutcome> => {
    // 0. **The per-client-address limit, before the address is read** (#158).
    //    Asked after the lookup, an unknown or verified address would answer
    //    `sent` without ever being counted, and one client could walk a list
    //    of addresses unlimited. Its refusal is `too-many` with its "when":
    //    it depends on the client alone, so it reveals nothing about the
    //    address, and the hold screen already knows how to say it.
    const admission = await input.clientLimiter.admit(input.clientAddress);
    if (admission.state === "rate-limited") {
      return { state: "too-many", retryAfterMs: admission.retryAfterMs };
    }

    const account = await input.directory.byEmail(input.email);

    // Nothing to send, and nothing to admit. Indistinguishable by design.
    if (account === undefined || account.emailVerified) {
      return { state: "sent" };
    }

    const limits = input.limits ?? RESEND_LIMITS;
    const now = input.clock.now();
    const since = new Date(now.getTime() - limits.windowMs);
    const recent = await input.dispatches.since(account.userId, since);

    const allowance = resendAllowance({
      sentAt: recent.map((dispatch) => dispatch.sentAt),
      now,
      limits,
    });

    if (allowance.state !== "allowed") {
      return allowance;
    }

    // The stored address, not the typed one: the mailer looks the Account up
    // again by it, and a difference in case should not become a miss.
    await input.mailer.send(account.email);
    return { state: "sent" };
  });
}
