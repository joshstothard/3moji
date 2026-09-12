import type { EmailSender, OutboundEmail } from "../ports/email-sender";

export interface RecordingEmailSender extends EmailSender {
  /** Every email this sender was asked to deliver, oldest first. */
  readonly sent: readonly OutboundEmail[];
  /** The most recent email, which is usually what an assertion wants. */
  lastSent(): OutboundEmail | undefined;
  clear(): void;
}

/**
 * An `EmailSender` that records instead of sending.
 *
 * Lives in `src` rather than a test helper because the integration suite uses
 * it too: those tests exercise real verification and reset flows against a real
 * database, and must not send real mail.
 */
export function createRecordingEmailSender(): RecordingEmailSender {
  const sent: OutboundEmail[] = [];

  return {
    sent,
    send: (email) => {
      sent.push(email);
      return Promise.resolve();
    },
    lastSent: () => sent.at(-1),
    clear: () => {
      sent.length = 0;
    },
  };
}
