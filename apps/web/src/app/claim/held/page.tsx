import {
  holdReasonFrom,
  resendNoticeFrom,
  retrySecondsFrom,
} from "../../../components/claim-state";
import { HoldScreen } from "../../../components/hold-screen";
import { requestNewVerificationLink } from "../../../components/resend-action";

interface HeldPageProps {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}

/**
 * The hold screen with no Handle named.
 *
 * **It exists because there is a case where naming one would be a guess.** A
 * link we have no record of — truncated by an email client, or belonging to an
 * Account that has since been deleted — tells us nothing about whose it was, and
 * the honest screen for that says so and offers a new link anyway. The same
 * page serves somebody who tried to sign in to an Account whose Handle could
 * not be read.
 *
 * A sibling route rather than a query parameter on the named one, because the
 * Handle is part of the *identity* of that page: `/claim/held/🧊🧊🧊` is about a
 * Handle and `/claim/held` is not, and folding the two into one route with an
 * optional parameter would make every reader check which case they were in.
 */
export default async function AnonymousHeldPage({
  searchParams,
}: HeldPageProps) {
  const query = await searchParams;

  return (
    <HoldScreen
      notice={resendNoticeFrom(query.notice)}
      reason={holdReasonFrom(query.reason)}
      resend={requestNewVerificationLink}
      retrySeconds={retrySecondsFrom(query.retry)}
    />
  );
}
