import type { Auth } from "../auth-factory";
import type { VerificationMailer } from "../resend-verification";

/**
 * {@link VerificationMailer} over Better Auth's `/send-verification-email`.
 *
 * A three-line adapter, and the three lines are all boundary: the use case
 * above it decides *whether* to send, which is the part with rules in it, and
 * this decides nothing.
 *
 * **No `callbackURL` is passed.** Better Auth would percent-encode it into the
 * link it builds, and the link is not the one that gets sent — `createAuth`'s
 * `sendVerificationEmail` hook rewrites it to point at our own verification
 * page, from the token. Passing one would mean carrying a value that has no
 * effect and reads as though it does.
 *
 * The endpoint is called with no session, which is the branch that enforces
 * Better Auth's own 500 ms floor and sends nothing for an unknown or
 * already-verified address. Our own floor covers the branches that never reach
 * it, so the two agree.
 */
export function createBetterAuthVerificationMailer(
  auth: Auth,
): VerificationMailer {
  return {
    send: async (email: string): Promise<void> => {
      await auth.api.sendVerificationEmail({ body: { email } });
    },
  };
}
