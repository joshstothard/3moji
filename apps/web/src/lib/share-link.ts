import { canonicalAliasOf } from "@template/core";

import { configuredSiteUrl } from "./site-url";

/**
 * The link a claimed Profile offers for sharing: the site origin, `/`, and the
 * Handle's **canonical word alias**
 * ([#160](https://github.com/joshstothard/3moji/issues/160)).
 *
 * ADR-0008 decision 3 makes the canonical alias what the product publishes,
 * copies to the clipboard and prints. The percent-encoded emoji URL was
 * rejected as the shareable form — 45 characters of `%F0%9F…`, and an
 * autolinker truncates the raw emoji path and drops the Handle — so it is never
 * built here: the path is `canonicalAliasOf`'s dot-separated slugs, which are
 * ASCII by construction.
 *
 * **Server-only.** It reads the environment, so it runs in the route and hands
 * the finished string to the client component as a prop; nothing in the
 * browser bundle reads a variable or learns anything but the link itself.
 */
export interface ShareLink {
  /** The whole link, exactly as it is copied. */
  readonly href: string;
  /** The canonical alias on its own — the path of {@link href}. */
  readonly alias: string;
}

/** The only schemes a shared link may carry. */
const ALLOWED_SCHEMES: readonly string[] = ["http:", "https:"];

/**
 * Where the app is served from, as a bare origin, or `undefined` when that is
 * not configured.
 *
 * **It is `BETTER_AUTH_URL`, reused rather than joined by a new variable.**
 * `apps/web/.env.example` already documents it as "where the app is served
 * from", `lib/services.ts` already requires it, and Better Auth builds the
 * verification links it emails from the same value — so a share link and a
 * verification link cannot disagree about the host. A second variable would
 * fork the five-variable environment contract that `services.ts`, the E2E job
 * and `turbo.json` all enumerate, for a value that must always be equal to
 * this one.
 *
 * It is read here directly rather than through `getServices()`, which throws
 * unless all five variables are set and opens a database pool: a link is a
 * string and needs neither.
 *
 * **Reduced to the origin** — scheme, host and port — so a trailing slash or a
 * path in the configured value cannot produce `//ice-cube…` or a link under
 * `/api/auth`. **A missing or unusable value is `undefined`, never a guessed
 * host**: a hard-coded `3moji.me` would ship preview deployments links to
 * production. On a Vercel preview the value is the deployment's own address
 * (`lib/site-url.ts`, #32), for the same reason.
 */
export function siteOrigin(): string | undefined {
  const value = configuredSiteUrl(process.env);
  if (value === undefined || value === "") return undefined;

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return undefined;
  }

  if (!ALLOWED_SCHEMES.includes(parsed.protocol)) return undefined;
  return parsed.origin;
}

/**
 * The share link for the Handle made of `codepoints`, or `undefined` when there
 * is none to offer — no configured origin, or no canonical alias.
 *
 * Omitted rather than partial, for the reason `SpokenLine` omits itself: a
 * control that copies `undefined` or a bare origin is worse than no control.
 */
export function shareLinkOf(
  codepoints: readonly string[],
): ShareLink | undefined {
  const origin = siteOrigin();
  if (origin === undefined) return undefined;

  const alias = canonicalAliasOf(codepoints);
  if (alias === undefined) return undefined;

  return { href: `${origin}/${alias}`, alias };
}
