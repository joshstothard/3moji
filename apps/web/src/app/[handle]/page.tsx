import { notFound, permanentRedirect } from "next/navigation";
import {
  canonicalise,
  spokenHandle,
  type CanonicalHandle,
} from "@template/core";

/**
 * The Handle route: `3moji.me/🧊🧊🧊`.
 *
 * A thin transport adapter, which is all a route is allowed to be under
 * [ADR-0006](../../../../../docs/adr/0006-nextjs-on-vercel-is-the-whole-application.md)
 * decision 1 — it parses, calls the domain, and formats. The canonicalisation
 * rule itself is [ADR-0004](../../../../../docs/adr/0004-the-handle-model.md)
 * decision 1 and lives in `packages/core`; nothing here decodes, normalises or
 * validates a code point.
 *
 * Three facts from
 * [the emoji URL report](../../../../../docs/reports/2026-09-11-emoji-urls.md)
 * shape the code below, and all three were re-confirmed against this Next.js
 * version while writing it:
 *
 * - `params.handle` arrives **still percent-encoded** — `/🧊🧊🧊` and
 *   `/%F0%9F%A7%8A…` both reach here as the 36-character encoded string — so it
 *   is passed to `canonicalise` untouched, which is what decodes it (exactly
 *   once, in a `try/catch`).
 * - Next.js **upper-cases the escapes** before we see them, so a lower-case-hex
 *   request is already canonical and no redirect is needed for it. The spelling
 *   that genuinely differs is a stray variation selector: `…%EF%B8%8F` survives
 *   into the segment and is what `isCanonical: false` is for.
 * - `permanentRedirect` is given `encoded`, never `key`. A raw emoji in a
 *   `Location` header fails Node's header validation with `ERR_INVALID_CHAR`
 *   and serves a 500.
 *
 * A malformed sequence such as `/%F0%9F` never reaches this component at all —
 * Next.js rejects it first (400 in dev, 500 in production). `malformed-encoding`
 * is still handled, because `canonicalise` can be reached by other callers and a
 * route that trusts the framework to have filtered its input is a route that
 * breaks when the framework changes.
 */
interface HandlePageProps {
  readonly params: Promise<{ readonly handle: string }>;
}

export default async function HandlePage({ params }: HandlePageProps) {
  const { handle } = await params;
  const result = canonicalise(handle);

  if (!result.ok) {
    // Every rejection reason is a 404. They are different answers to the
    // domain — "not an emoji we know" is not "not claimable yet" — but over
    // HTTP they are one: there is no Handle at this URL. Redirecting or
    // explaining would only help a crawler index junk.
    notFound();
  }

  if (!result.isCanonical) {
    permanentRedirect(`/${result.encoded}`);
  }

  return <AvailableHandle handle={result} />;
}

/**
 * **Deliberately minimal.** Nothing can be claimed yet — the claim flow is
 * Phase 3 and the Profile is Phase 4 — so every Handle that resolves is
 * unclaimed, and this page says exactly that and stops. It reads no database,
 * which also keeps it honest: a read would go through `lib/services.ts`, whose
 * five required environment variables are not all set in CI's E2E job.
 *
 * The emoji carry the meaning, so they are the heading, and `role="img"` with
 * the Spoken Name as the accessible name is what makes the heading announce as
 * "three ice cubes" rather than as three code points read out one by one.
 */
function AvailableHandle({ handle }: { readonly handle: CanonicalHandle }) {
  const spoken = spokenHandle(handle.emoji.map((entry) => entry.emoji));

  return (
    <main className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-24">
      <div className="text-center">
        <h1 className="text-6xl sm:text-7xl mb-8 tracking-tight">
          <span role="img" aria-label={spoken ?? handle.key}>
            {handle.key}
          </span>
        </h1>
        <p className="text-lg text-slate-500">This Handle is available.</p>
      </div>
    </main>
  );
}
