import type { MetadataRoute } from "next";
import { siteOrigin } from "../lib/share-link";

/**
 * The only paths the sitemap lists: the home page and the two legal pages
 * ([#204](https://github.com/joshstothard/3moji/issues/204)).
 *
 * **No Profile, ever.** A sitemap of claimed Handles would publish a list of
 * every one of them, which the product never offers anywhere else. `/find` and
 * `/reset-password` are left out too: both are `noindex`.
 */
const STATIC_PATHS: readonly string[] = ["/", "/privacy", "/terms"];

/**
 * `/sitemap.xml`. Every entry is absolute, built from `siteOrigin()` — the
 * origin share links and Open Graph URLs use — read when the route renders,
 * not at module scope. The route is static, so that is at build time. **With no configured origin the sitemap is empty**, rather
 * than listing URLs on a guessed host: a sitemap entry must be absolute.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const origin = siteOrigin();
  if (origin === undefined) return [];

  return STATIC_PATHS.map((path) => ({ url: `${origin}${path}` }));
}
