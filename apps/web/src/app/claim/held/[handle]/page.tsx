import { canonicalise } from "@template/core/browser";
import { notFound } from "next/navigation";

import {
  holdReasonFrom,
  resendNoticeFrom,
  retrySecondsFrom,
} from "../../../../components/claim-state";
import { HoldScreen } from "../../../../components/hold-screen";
import { requestNewVerificationLink } from "../../../../components/resend-action";

interface HeldPageProps {
  readonly params: Promise<{ readonly handle: string }>;
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}

/**
 * The hold screen for a named Handle: `/claim/held/%F0%9F%A7%8A…`.
 *
 * A thin transport adapter, which is all a route is allowed to be under
 * [ADR-0006](../../../../../../docs/adr/0006-nextjs-on-vercel-is-the-whole-application.md)
 * decision 1: it parses the segment, whitelists the query, and hands both to
 * the component.
 *
 * **It reads no database, and that is deliberate.** Everything it needs is in
 * the URL, so the page renders on a clone with no environment at all — and, more
 * to the point, a Handle *name* is public (it is a URL) while who is holding it
 * is not. There is nothing to look up that would not be a leak: ADR-0004 treats
 * a countdown on somebody else's hold as an information leak and an invitation
 * to wait, so no expiry time is shown either. The page is reachable by anybody
 * who guesses the URL, and shows them nothing they did not already know.
 *
 * `params.handle` arrives **still percent-encoded** and with its escapes
 * upper-cased, so it goes to `canonicalise` untouched — the same contract
 * `/[handle]` documents. An unparseable segment is a 404 rather than a
 * redirect: there is no hold screen for a thing that is not a Handle.
 */
export default async function HeldPage({
  params,
  searchParams,
}: HeldPageProps) {
  const { handle } = await params;
  const query = await searchParams;
  const result = canonicalise(handle);

  if (!result.ok) {
    notFound();
  }

  return (
    <HoldScreen
      encoded={result.encoded}
      handleKey={result.key}
      notice={resendNoticeFrom(query.notice)}
      reason={holdReasonFrom(query.reason)}
      resend={requestNewVerificationLink}
      retrySeconds={retrySecondsFrom(query.retry)}
    />
  );
}
