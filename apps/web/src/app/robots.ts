import type { MetadataRoute } from "next";
import { siteOrigin } from "../lib/share-link";

/**
 * `/robots.txt` ([#204](https://github.com/joshstothard/3moji/issues/204)):
 * every crawler may fetch every page, and the sitemap is named on the
 * configured origin.
 *
 * Pages that must stay out of an index say so themselves with `robots`
 * metadata (`/find`, `/reset-password`); a `Disallow` here would stop a crawler
 * reading that `noindex` at all. **With no configured origin the `Sitemap` line
 * is left out**, rather than naming a guessed host.
 */
export default function robots(): MetadataRoute.Robots {
  const rules = { userAgent: "*", allow: "/" };
  const origin = siteOrigin();
  if (origin === undefined) return { rules };

  return { rules, sitemap: `${origin}/sitemap.xml` };
}
