import { spokenHandle } from "../emoji/spoken-handle";
import type { AccountDirectory } from "../ports/account-directory";
import type { EmailSender, OutboundEmail } from "./ports/email-sender";

export interface ClaimCollisionEmailInput {
  readonly to: string;
  /** The Handle this address already owns or holds. */
  readonly handleKey: string;
  /** Where to go to ask for a password reset. A form, not a tokenised link. */
  readonly resetRequestUrl: string;
  readonly from: string;
}

/**
 * The email an existing address gets when somebody tries to claim with it.
 *
 * **The link is to the reset *form*, not a tokenised reset link, and that is a
 * security decision rather than a shortcut.** Sign-up is unauthenticated, so a
 * tokenised link here would mean any stranger could post a victim's address at
 * the claim form and cause a live password-reset token to be mailed to them, as
 * often as they liked. A link to a form hands out no credential, so the worst
 * an attacker achieves is a nuisance message. #15 asks for "a reset link"; this
 * is the shape of it that cannot be turned into a weapon.
 *
 * How many of these one address can receive is bounded before this is ever
 * reached: `submitClaim` refuses a submission past the per-email rate limit
 * before the Claim opens, so a flood of Claims naming one inbox produces at
 * most three notices an hour
 * ([#157](https://github.com/joshstothard/3moji/issues/157)).
 *
 * **No token appears in the subject.** Nothing tokenised appears anywhere in
 * this message, but the rule the subject line obeys is the general one: subjects
 * are logged, previewed on lock screens and indexed far more widely than
 * bodies.
 */
export function claimCollisionEmail(
  input: ClaimCollisionEmailInput,
): OutboundEmail {
  // `Array.from` rather than a spread: the lint rule forbids spreading a
  // string, and this is the idiom `canonicalise` already uses — it drives the
  // string iterator, which yields code points. Every Emoji Set entry is a
  // single code point (ADR-0005 decision 1), so this is exactly three emoji.
  const spoken = spokenHandle(Array.from(input.handleKey));
  const said = spoken === undefined ? "" : ` — ${spoken} —`;

  return {
    to: input.to,
    subject: "Someone tried to sign up with your 3moji email",
    text:
      `Somebody just tried to claim a 3moji handle using this email address.\n\n` +
      `Nothing changed. You already have an account here, and it owns ${input.handleKey}${said} so nobody else can take it.\n\n` +
      `If that was you and you have forgotten your password, you can set a new one: ${input.resetRequestUrl}\n\n` +
      `If it was not you, there is nothing to do.\n\nFrom ${input.from}`,
  };
}

export interface ClaimCollisionInput {
  /** The address that was submitted, and that already has an Account. */
  readonly email: string;
  readonly directory: AccountDirectory;
  readonly emailSender: EmailSender;
  readonly resetRequestUrl: string;
  readonly from: string;
}

/**
 * Tells the existing owner that their address was used in a Claim attempt.
 *
 * This is the other half of the non-enumeration promise, and the half that
 * makes it honest rather than merely silent. The submitter gets the ordinary
 * hold screen, which reveals nothing; the person who actually owns the address
 * is the one told something happened, through a channel only they can read
 * ([#15](https://github.com/joshstothard/3moji/issues/15)).
 *
 * It sends nothing when the address has no Account or no Handle. Neither is
 * reachable from the Claim path that calls it — the domain answered
 * `already-registered` because a `user` row was there — but a notifier that
 * mailed "you already own a handle" to somebody who owns none would be worse
 * than silence, so the check is here rather than assumed.
 */
export async function notifyExistingOwner(
  input: ClaimCollisionInput,
): Promise<void> {
  const account = await input.directory.byEmail(input.email);
  if (account === undefined) return;

  const owned = await input.directory.handleOf(account.userId);
  if (owned === undefined) return;

  await input.emailSender.send(
    claimCollisionEmail({
      // The address as stored, not as typed: a difference in case is not a
      // different Account, and the stored form is the one that was verified.
      to: account.email,
      handleKey: owned.key,
      resetRequestUrl: input.resetRequestUrl,
      from: input.from,
    }),
  );
}
