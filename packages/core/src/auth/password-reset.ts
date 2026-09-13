import type { Clock } from "../ports/clock";
import type { ResetRequestClientRateLimiter } from "./reset-request-rate-limit";
import { realSleep, withResponseFloor } from "./response-floor";

/**
 * The two things password reset needs from Better Auth
 * ([#192](https://github.com/joshstothard/3moji/issues/192)).
 *
 * A port rather than the auth instance, as `VerificationMailer` is, so
 * the use cases are testable without standing up Better Auth and the limit is
 * provably *in front of* the request rather than beside it.
 */
export interface PasswordResetter {
  /**
   * Asks for a reset link to be mailed to `email`, if it names an Account.
   *
   * Answers `accepted` whether or not it does — Better Auth's endpoint answers
   * the same for both, and sends nothing for an unknown address — and
   * `invalid` only for input Better Auth's own schema refuses before any
   * lookup, which says nothing about registration either.
   */
  request(email: string): Promise<"accepted" | "invalid">;
  /** Sets a new password from a reset token, consuming the token. */
  reset(token: string, newPassword: string): Promise<SetNewPasswordOutcome>;
}

/**
 * What a reset request is told.
 *
 * **`sent` does not mean an email went out.** A registered address and an
 * unregistered one both produce it, because the alternative is a form that
 * answers "does this address have an Account here" for anyone who asks.
 */
export type PasswordResetRequestOutcome =
  | { readonly state: "sent" }
  | { readonly state: "invalid" }
  | { readonly state: "rate-limited" };

export interface RequestPasswordResetInput {
  /** The address as typed. Never trusted, never used as an identity. */
  readonly email: string;
  /**
   * The client's network address as the transport read it from the forwarded
   * headers, or `undefined`. Not trusted: the limiter validates and groups it.
   */
  readonly clientAddress: string | undefined;
  /** The per-client-address limit, asked before anything else. */
  readonly clientLimiter: ResetRequestClientRateLimiter;
  readonly resetter: PasswordResetter;
  readonly clock: Clock;
  /** Injected so a test proves the timing floor without waiting for it. */
  readonly sleep?: (ms: number) => Promise<void>;
  readonly floorMs?: number;
}

/**
 * Ask for a password-reset link.
 *
 * Two steps, in this order, inside the 500 ms response floor:
 *
 * 1. **The per-client-address limit, before the address is read.** Better
 *    Auth's own limiter never sees a server-side `auth.api.*` call (#180), so
 *    without this the form would send mail to any address as often as it was
 *    asked. Handed the client address alone, so its refusal is identical for
 *    every address.
 * 2. **The request.** Better Auth looks the address up, and for a registered
 *    one signs a token and mails the link; for an unknown one it simulates the
 *    work and sends nothing. Both answer `sent`. The link is mailed after the
 *    answer (#216), so neither a slow provider nor a failing one reaches it.
 *
 * **Every answer is padded**, the refusal included. The fast branches — a
 * refusal, an unknown address — are what a floor exists for; padding all of
 * them rather than choosing keeps one rule.
 */
export async function requestPasswordReset(
  input: RequestPasswordResetInput,
): Promise<PasswordResetRequestOutcome> {
  const floor = {
    clock: input.clock,
    sleep: input.sleep ?? realSleep,
    ...(input.floorMs === undefined ? {} : { floorMs: input.floorMs }),
  };

  return withResponseFloor(
    floor,
    async (): Promise<PasswordResetRequestOutcome> => {
      const admission = await input.clientLimiter.admit(input.clientAddress);
      if (admission.state === "rate-limited") {
        return { state: "rate-limited" };
      }

      const email = input.email.trim();
      if (email === "") return { state: "invalid" };

      const answer = await input.resetter.request(email);
      return answer === "invalid" ? { state: "invalid" } : { state: "sent" };
    },
  );
}

/**
 * What setting a new password is told.
 *
 * `invalid-link` covers a token that never existed, one already used and one
 * that has expired alike: which of the three it was is nobody's business, and
 * the remedy — ask for a new link — is the same.
 */
export type SetNewPasswordOutcome =
  | { readonly state: "reset" }
  | { readonly state: "invalid-link" }
  | { readonly state: "password-too-short" }
  | { readonly state: "password-too-long" };

export interface SetNewPasswordInput {
  /** From the link's path segment. Public input. */
  readonly token: string;
  readonly newPassword: string;
  readonly resetter: PasswordResetter;
}

/**
 * Set a new password from a reset link's token.
 *
 * The rules that matter here are Better Auth's and are configured in
 * `createAuth`: **every session is revoked** (`revokeSessionsOnPasswordReset`)
 * and **the email is not marked verified** — a reset proves control of the
 * address, but the Claim gate keeps exactly one meaning (#15). This use case
 * adds only the guard that an empty token is an invalid link rather than a
 * request Better Auth would have to refuse.
 *
 * No response floor: the answer depends on a 24-character random token, not
 * on an address, so its timing has nothing about anybody to give away.
 */
export async function setNewPassword(
  input: SetNewPasswordInput,
): Promise<SetNewPasswordOutcome> {
  if (input.token.trim() === "") return { state: "invalid-link" };
  return input.resetter.reset(input.token, input.newPassword);
}
