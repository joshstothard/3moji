/**
 * What Vercel Web Analytics is allowed to record about a page (PR #238).
 *
 * Analytics records the URL of every page view, and two kinds of URL must not
 * reach it:
 *
 * - **`/reset-password/<token>`** holds a live, single-use password reset token
 *   in its path. The token segment, and anything after it, becomes a fixed
 *   placeholder. Matched case-insensitively, because a 404 renders the root
 *   layout too and so records whatever path was typed.
 * - **Every query string and fragment** is dropped. Today they carry only
 *   fixed notices and the Find a Handle lookup's typed words, but a parameter
 *   added later should not have to remember to opt out.
 *
 * Pure and framework-free, so it is unit tested without a browser. It never
 * throws: a URL that cannot be parsed drops the event rather than sending it
 * unredacted.
 */

const RESET_TOKEN_PATH = /^\/reset-password\/.+$/i;
const REDACTED_RESET_PATH = "/reset-password/[token]";

/** A URL with a scheme, such as `https:`, as opposed to a path. */
const HAS_SCHEME = /^[a-z][a-z\d+.-]*:/i;

/** Resolves relative URLs only; never appears in the output. */
const RELATIVE_BASE = "https://relative.invalid";

function redactUrl(url: string): string | null {
  const absolute = HAS_SCHEME.test(url);
  let parsed: URL;
  try {
    parsed = absolute ? new URL(url) : new URL(url, RELATIVE_BASE);
  } catch {
    return null;
  }

  const path = RESET_TOKEN_PATH.test(parsed.pathname)
    ? REDACTED_RESET_PATH
    : parsed.pathname;

  if (!absolute) return path;
  // `about:`, `data:` and the like have no origin to keep.
  if (parsed.origin === "null") return null;
  return `${parsed.origin}${path}`;
}

export function redactAnalyticsEvent<E extends { readonly url: string }>(
  event: E,
): E | null {
  const url = redactUrl(event.url);
  return url === null ? null : { ...event, url };
}
