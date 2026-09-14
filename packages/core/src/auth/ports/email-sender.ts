/**
 * One transactional email the domain wants delivered.
 *
 * **Always multipart** ([#240](https://github.com/joshstothard/3moji/issues/240)):
 * `text` and `html` carry the same content. A text-only email that is little
 * more than a long bare link is what spam filters score as junk, and the first
 * live verification email landed in Outlook's Junk folder. `html` is required
 * rather than optional so an email cannot be added that forgets it. Build both
 * parts with `renderEmail` in `../email-template`, which escapes every value.
 */
export interface OutboundEmail {
  readonly to: string;
  readonly subject: string;
  readonly text: string;
  readonly html: string;
}

/**
 * Sends transactional email.
 *
 * A port rather than a direct call to a provider, so verification and
 * password-reset flows can be tested without sending real mail. Production
 * wires the Resend adapter; tests wire the recording one.
 */
export interface EmailSender {
  send(email: OutboundEmail): Promise<void>;
}
