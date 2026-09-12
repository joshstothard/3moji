/**
 * Why somebody is looking at the hold screen.
 *
 * Six states rather than one "check your email", because the copy is the
 * feature: #82 exists because the verification token lasts an hour while the
 * hold lasts a day, so a dead link with a live Hold is the *ordinary* case. A
 * screen that said the same thing in all six would be the defect.
 */
export const HOLD_REASONS = [
  /** Just claimed. The link is on its way. */
  "pending",
  /** The link died of old age. The Handle is still held. */
  "link-expired",
  /** An older link, after a resend. The Handle is still held. */
  "link-superseded",
  /** Signed in before verifying. Better Auth said 403; this is not an error. */
  "unverified",
  /** A link we have no record of. Nothing truthful to say about a Handle. */
  "link-unknown",
  /** The 24 hours ran out. This is the only one where the Handle is gone. */
  "hold-expired",
] as const;

export type HoldReason = (typeof HOLD_REASONS)[number];

/** What the resend form did last time, if it has run. */
export const RESEND_NOTICES = [
  "sent",
  "too-soon",
  "too-many",
  "invalid",
  "failed",
] as const;

export type ResendNotice = (typeof RESEND_NOTICES)[number];

/**
 * The first value of a Next.js search parameter, which may be an array.
 *
 * `?reason=a&reason=b` arrives as `["a", "b"]`, and a page that assumed a
 * string would render `undefined` into its own copy.
 */
function first(value: string | readonly string[] | undefined): string {
  if (value === undefined) return "";
  return typeof value === "string" ? value : (value[0] ?? "");
}

/**
 * Parse the `reason` query parameter.
 *
 * **A query string is public input**, so this is a whitelist rather than a
 * cast: anything unrecognised becomes `pending`, the state that reveals
 * nothing and tells no lies. The alternative — trusting the parameter — would
 * let a crafted URL show somebody "that hold has run out" about a Handle that
 * is perfectly healthy.
 */
export function holdReasonFrom(
  value: string | readonly string[] | undefined,
): HoldReason {
  const candidate = first(value);
  return HOLD_REASONS.find((reason) => reason === candidate) ?? "pending";
}

/** Parse the `notice` query parameter. Unrecognised means "nothing happened". */
export function resendNoticeFrom(
  value: string | readonly string[] | undefined,
): ResendNotice | undefined {
  const candidate = first(value);
  return RESEND_NOTICES.find((notice) => notice === candidate);
}

/**
 * Parse the `retry` query parameter: whole seconds, and nothing hostile.
 *
 * It is interpolated into copy a person reads, so a non-numeric value has to
 * become nothing rather than `NaN` — and a negative or absurd one has to become
 * nothing too, because "try again in -4 seconds" is worse than no hint at all.
 */
export function retrySecondsFrom(
  value: string | readonly string[] | undefined,
): number | undefined {
  const candidate = first(value);
  if (!/^\d{1,5}$/.test(candidate)) return undefined;
  const seconds = Number(candidate);
  return seconds > 0 ? seconds : undefined;
}
