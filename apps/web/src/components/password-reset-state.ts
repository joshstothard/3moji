/**
 * What the password reset pages are told through the query string (#192).
 *
 * **Whitelisted**, because a query string is public input that lands in copy:
 * anything else reads as nothing at all.
 */

/** The request form's notice, from `?notice=`. */
export type ResetRequestNotice =
  "sent" | "invalid" | "rate-limited" | "failed" | "link-invalid";

const REQUEST_NOTICES: readonly ResetRequestNotice[] = [
  "sent",
  "invalid",
  "rate-limited",
  "failed",
  "link-invalid",
];

/** The set-new-password form's refusal, from `?error=`. */
export type SetNewPasswordError = "too-short" | "too-long" | "failed";

const SET_ERRORS: readonly SetNewPasswordError[] = [
  "too-short",
  "too-long",
  "failed",
];

function firstOf(value: string | string[] | undefined): string | undefined {
  return typeof value === "string" ? value : value?.[0];
}

export function resetRequestNoticeFrom(
  value: string | string[] | undefined,
): ResetRequestNotice | undefined {
  const candidate = firstOf(value);
  return REQUEST_NOTICES.find((notice) => notice === candidate);
}

export function setNewPasswordErrorFrom(
  value: string | string[] | undefined,
): SetNewPasswordError | undefined {
  const candidate = firstOf(value);
  return SET_ERRORS.find((error) => error === candidate);
}
