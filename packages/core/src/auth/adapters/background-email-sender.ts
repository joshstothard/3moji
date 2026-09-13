import type { BackgroundTasks } from "../../ports/background-tasks";
import type { EmailSender } from "../ports/email-sender";

/**
 * The event each deferred email's failure is logged under
 * ([#216](https://github.com/joshstothard/3moji/issues/216)).
 *
 * Better Auth has one sender slot, so its two emails — the reset link and the
 * verification link — share `auth`. The other two are ours, and each names
 * its email.
 */
export const DEFERRED_EMAIL_FAILURE_EVENTS = {
  auth: "auth_email_send_failed",
  claimCollision: "claim_collision_email_failed",
  claimVerification: "claim_verification_email_failed",
} as const;

export interface BackgroundEmailSenderInput {
  /** The sender that actually talks to the provider. */
  readonly inner: EmailSender;
  readonly tasks: BackgroundTasks;
  /** What a failed send is logged as. */
  readonly event: string;
}

/**
 * An {@link EmailSender} that hands every send to the background and answers
 * at once ([#216](https://github.com/joshstothard/3moji/issues/216)).
 *
 * **Why.** Every answer that must not reveal whether an address is registered
 * is padded to `RESPONSE_FLOOR_MS`, and a floor only pads answers that finish
 * *early*. A registered address makes a real send, which waits on the provider
 * and can outlast the floor or throw; an unregistered one sends nothing. Sent
 * inside the request, both the send's duration and its failure reached the
 * response — for registered addresses only. Handed to the background, neither
 * can.
 *
 * **The caller's order still holds.** `send` is called exactly where it always
 * was — in `createAuth`'s verification hook, after the dispatch row has been
 * awaited — and it resolves once the send is scheduled. So "recorded before it
 * is sent" is still true; the email simply reaches the provider later.
 *
 * **A failure is the background's to report**, under `event`. It never reaches
 * the caller, so the person is told the same thing either way, and the log is
 * where a failed send shows up.
 *
 * Not Better Auth's own `advanced.backgroundTasks.handler`, which would hand
 * off each hook *whole*: the dispatch write would run detached, on the Claim's
 * transactional instance after the transaction had closed, and a failure would
 * reach Better Auth's logger with its raw message.
 */
export function createBackgroundEmailSender(
  input: BackgroundEmailSenderInput,
): EmailSender {
  const { inner, tasks, event } = input;

  return {
    send: (email) => {
      tasks.run(event, () => inner.send(email));
      return Promise.resolve();
    },
  };
}
