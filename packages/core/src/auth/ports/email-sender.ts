/** One transactional email the domain wants delivered. */
export interface OutboundEmail {
  readonly to: string;
  readonly subject: string;
  readonly text: string;
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
