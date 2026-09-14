import { EMAIL_COPY, renderEmail } from "./email-template";
import type { OutboundEmail } from "./ports/email-sender";

export interface AccountEmailInput {
  readonly to: string;
  /** The finished link, token included. Travels in the body only. */
  readonly link: string;
  /** The verified sender, e.g. `3moji <no-reply@mail.3moji.me>`. */
  readonly from: string;
}

/**
 * The verification email: sent on a Claim and on every resend.
 *
 * The token travels in the link only, never the subject: subjects are logged,
 * previewed on lock screens and indexed far more widely than bodies.
 */
export function verificationEmail(input: AccountEmailInput): OutboundEmail {
  const copy = EMAIL_COPY.verification;
  return renderEmail(input.to, {
    subject: copy.subject,
    heading: copy.heading,
    before: [copy.intro],
    action: { label: copy.action, url: input.link },
    after: [copy.hold, copy.expired],
    from: input.from,
  });
}

/** The password-reset email. The token travels in the link only. */
export function passwordResetEmail(input: AccountEmailInput): OutboundEmail {
  const copy = EMAIL_COPY.passwordReset;
  return renderEmail(input.to, {
    subject: copy.subject,
    heading: copy.heading,
    before: [copy.intro],
    action: { label: copy.action, url: input.link },
    after: [copy.once, copy.ignore],
    from: input.from,
  });
}
