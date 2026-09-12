import type { EmailSender, OutboundEmail } from "../ports/email-sender";

export interface DeferredEmailSender extends EmailSender {
  /** Emails held back so far, oldest first. */
  readonly held: readonly OutboundEmail[];
  /** Deliver everything held, in the order it was sent to. */
  flush(): Promise<void>;
  /** Throw everything held away. The transaction it belonged to is gone. */
  discard(): void;
}

/**
 * An {@link EmailSender} that holds emails until the transaction commits.
 *
 * **An email cannot be rolled back.** Better Auth sends the verification email
 * from inside `signUpEmail` (`sendOnSignUp`), and the Claim calls that inside
 * its transaction — so on every rejected Claim, a Handle lost to a race
 * included, the stock wiring would send "verify your email to claim your
 * handle" for an Account that never existed. That is a worse failure than the
 * rejection itself: it is a message about a thing that did not happen.
 *
 * Buffering is the narrowest fix. The Claim wraps the real sender in this one
 * for the duration of its transaction, flushes after the commit and discards
 * after a rollback, and nothing else in the system changes.
 *
 * `flush` sends **sequentially** rather than through `Promise.all`: these are
 * ordered messages to one person, and a provider that reorders them is a defect
 * the caller cannot see. It is the one place the standards' "parallelise
 * independent async work" rule is deliberately not applied, because these are
 * not independent.
 */
export function createDeferredEmailSender(
  inner: EmailSender,
): DeferredEmailSender {
  const held: OutboundEmail[] = [];

  return {
    held,
    send: (email) => {
      held.push(email);
      return Promise.resolve();
    },
    flush: async () => {
      // Each email is dropped only **after** it went out, so a flush that
      // throws part-way neither resends what was delivered nor loses what was
      // not: what is left is still held, and still in order.
      while (held.length > 0) {
        const next = held[0];
        if (next === undefined) break;
        await inner.send(next);
        held.shift();
      }
    },
    discard: () => {
      held.length = 0;
    },
  };
}
