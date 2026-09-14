"use client";

import { Analytics } from "@vercel/analytics/next";

import { redactAnalyticsEvent } from "../lib/analytics-redaction";

/**
 * Vercel Web Analytics, with every URL redacted before it is sent (PR #238).
 *
 * A client component only because `beforeSend` is a function, and a server
 * component cannot pass a function to a client one. It reads no session and no
 * request headers (#193): the lint rule on the root layout covers this file too.
 */
export function SiteAnalytics() {
  return <Analytics beforeSend={redactAnalyticsEvent} />;
}
