/**
 * How often one Account may ask for a new verification link.
 *
 * **A starting value to tune, not a principle.** #15 picked three an hour as
 * strict enough for an email-sending endpoint without trapping someone whose
 * first message went to spam, and it is recorded as an open question on the
 * workstream. It lives here as one named constant, with an overridable
 * parameter on the decision below, so tuning it is a one-line change rather
 * than a hunt for a literal `3`.
 */
export interface ResendLimits {
  /** How many sends are allowed inside {@link windowMs}. */
  readonly maxPerWindow: number;
  /** The rolling window the count is taken over. */
  readonly windowMs: number;
  /** The shortest gap between two sends, whatever the window says. */
  readonly minimumIntervalMs: number;
}

export const RESEND_LIMITS: ResendLimits = {
  maxPerWindow: 3,
  windowMs: 60 * 60 * 1000,
  minimumIntervalMs: 60 * 1000,
};

/**
 * Whether a resend may go out, and if not, when to try again.
 *
 * `retryAfterMs` is carried because a refusal with no "when" is a dead end for
 * the person reading it, and the hold screen has to say something true.
 */
export type ResendAllowance =
  | { readonly state: "allowed" }
  /** The one-a-minute floor. */
  | { readonly state: "too-soon"; readonly retryAfterMs: number }
  /** The three-an-hour ceiling. */
  | { readonly state: "too-many"; readonly retryAfterMs: number };

export interface ResendAllowanceInput {
  /**
   * When this Account's previous verification links were issued, in any order.
   * Every issued token is recorded, so a sign-up counts as a send — the first
   * *resend* is the second link, which is what "three an hour" has to mean if
   * the limit is to bound the mail we send rather than the button presses.
   */
  readonly sentAt: readonly Date[];
  readonly now: Date;
  readonly limits?: ResendLimits;
}

/**
 * The rate-limit decision, as a pure function of the sends behind it.
 *
 * Pure and total on purpose: the limits are the part of this feature most
 * likely to be tuned, and a decision that needs a database and a clock to
 * exercise is a decision whose boundaries nobody tests. Both boundaries are
 * inclusive-exclusive in the same direction — a send exactly `windowMs` old has
 * aged out, and a gap of exactly `minimumIntervalMs` is long enough — so "three
 * an hour" cannot quietly become four.
 *
 * **The ceiling is reported ahead of the floor** where both bind. They are not
 * alternatives: a caller told "wait 40 seconds" who then waits 40 seconds and
 * is refused for the hour has been misled, and the longer wait is the one that
 * is actually true.
 */
export function resendAllowance(input: ResendAllowanceInput): ResendAllowance {
  const limits = input.limits ?? RESEND_LIMITS;
  const now = input.now.getTime();

  const inWindow = input.sentAt
    .map((sent) => sent.getTime())
    .filter((sent) => now - sent < limits.windowMs);

  if (inWindow.length >= limits.maxPerWindow) {
    // The oldest send in the window is the one whose ageing out frees a slot.
    const oldest = Math.min(...inWindow);
    return {
      state: "too-many",
      retryAfterMs: Math.max(0, oldest + limits.windowMs - now),
    };
  }

  // Every send counts towards the floor, including one that has aged out of the
  // window: the floor is about not sending two messages in quick succession.
  const newest = input.sentAt.reduce(
    (latest: number | undefined, sent) =>
      latest === undefined ? sent.getTime() : Math.max(latest, sent.getTime()),
    undefined,
  );

  if (newest !== undefined && now - newest < limits.minimumIntervalMs) {
    return {
      state: "too-soon",
      retryAfterMs: Math.max(0, newest + limits.minimumIntervalMs - now),
    };
  }

  return { state: "allowed" };
}
