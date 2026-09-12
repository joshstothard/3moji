import { canonicalise, spokenHandle } from "@template/core/browser";
import { notFound } from "next/navigation";

import en from "../../../../../../../packages/shared/messages/en.json";

const copy = en.Claim;

interface VerifiedPageProps {
  readonly params: Promise<{ readonly handle: string }>;
}

/**
 * Where a confirmed Claim lands: `/claim/verified/%F0%9F%A7%8A…`.
 *
 * ## Why this page exists rather than a redirect to the Handle
 *
 * #82's first acceptance criterion says verifying should land the new owner "on
 * their own Handle". It does not yet, and the reason is worth stating plainly
 * rather than smoothing over: `/[handle]` is a **placeholder that reads no
 * database** and renders "This Handle is available" for every Handle that
 * resolves — the Profile is Phase 4. Redirecting a new owner there would tell
 * them, in as many words, that the Handle they just claimed is free for anyone
 * to take.
 *
 * So this page confirms the Claim, says the Handle out loud, and links to it.
 * When the Profile lands, this becomes a redirect and the link becomes the
 * destination. That is one line, and it is flagged in the pull request rather
 * than left as a surprise.
 *
 * **It reads no session.** `autoSignInAfterVerification` does sign them in, but
 * the second click of a working link issues no session at all (Better Auth
 * answers an already-verified address with no cookie), and a page that needed
 * one would break for the commonest kind of double-click. Everything shown here
 * is in the URL, and all of it is public: the Handle is an address.
 */
export default async function VerifiedPage({ params }: VerifiedPageProps) {
  const { handle } = await params;
  const result = canonicalise(handle);

  if (!result.ok) {
    notFound();
  }

  // `Array.from`, not a spread: see the lint rule on misused spread, and the
  // code-point argument `canonicalise` documents.
  const spoken = spokenHandle(Array.from(result.key));

  return (
    <main className="max-w-2xl mx-auto px-4 sm:px-6 lg:px-8 py-24">
      <div className="text-center">
        <p className="text-6xl sm:text-7xl mb-6 tracking-tight">
          <span role="img" aria-label={spoken ?? result.key}>
            {result.key}
          </span>
        </p>

        <h1 className="text-3xl font-bold text-slate-900 mb-3 tracking-tight">
          {copy.verifiedHeading}
        </h1>

        {spoken !== undefined && (
          <p className="text-lg text-slate-500 mb-2">
            {copy.spoken.replace("{spoken}", spoken)}
          </p>
        )}

        <p className="text-lg text-slate-500">{copy.verifiedBody}</p>

        <p className="mt-8">
          <a
            className="inline-block rounded-xl bg-indigo-600 px-5 py-3 text-base font-semibold text-white hover:bg-indigo-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600"
            href={`/${result.encoded}`}
          >
            {copy.verifiedLink}
          </a>
        </p>
      </div>
    </main>
  );
}
