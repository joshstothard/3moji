import { notFound, permanentRedirect } from "next/navigation";
import {
  canonicalise,
  spokenHandle,
  type CanonicalHandle,
} from "@template/core";
import { readAvailability } from "../../lib/availability";
import type { AvailabilityState } from "../../components/availability-state";
import en from "../../../../../packages/shared/messages/en.json";

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

  // Both early exits are above, and deliberately so: `notFound` and
  // `permanentRedirect` signal by throwing, so anything that catches around
  // them — and the read below has a `try/catch` inside it — would swallow the
  // 404 and the 308 and answer 200 with an availability line for junk.
  const state = await readAvailability(result.encoded);

  return <ResolvedHandle handle={result} state={state} />;
}

const copy = en.HandlePage;

/**
 * What a visitor can be told about a Handle that resolves.
 *
 * `not-a-handle` is excluded because this component cannot be reached with
 * one: the route canonicalised the segment itself and 404'd every rejection
 * before the read. Excluding it is better than inventing copy that can never
 * be shown — a string a translator would have to translate and nobody would
 * ever read.
 */
type ResolvedState = Exclude<AvailabilityState, "not-a-handle">;

/**
 * One line per answer, and a `Record` over the union rather than a `switch`, so
 * a sixth state cannot be added to the domain without this failing to compile.
 *
 * Two of the five are the point of
 * [#68](https://github.com/joshstothard/3moji/issues/68):
 *
 * - **Reserved says nothing about why.** `/🍕🍕🍕` is platform-owned and
 *   `/🔪🔪🔪` carries a blocked emoji, and both read the same line. Naming the
 *   block would be a hint to go looking for the list — and the page could not
 *   name it even carelessly, because `readAvailability` answers with a state
 *   name and the `Reservation` carrying the reason never leaves the domain.
 * - **Held says nothing about who or until when.** ADR-0004 treats a countdown
 *   as an information leak and an invitation to wait. Same mechanism: there is
 *   no expiry in a state name to render.
 */
const AVAILABILITY_COPY: Readonly<Record<ResolvedState, string>> = {
  available: copy.stateAvailable,
  held: copy.stateHeld,
  claimed: copy.stateClaimed,
  "not-claimable": copy.stateNotClaimable,
  unknown: copy.stateUnknown,
};

/**
 * A Handle that resolves, and what is true about it.
 *
 * **It resolves whatever that answer is.** A Reserved Handle is a real,
 * well-formed Handle that nobody may own, so 404 would be a lie of the opposite
 * kind to the one #68 reported; a claimed one gets its Profile in Phase 4.
 *
 * The emoji carry the meaning, so they are the heading, and `role="img"` with
 * the Spoken Name as the accessible name is what makes the heading announce as
 * "three ice cubes" rather than as three code points read out one by one.
 *
 * Swap suggestions are deliberately **not** here. They are offered where a
 * visitor is picking — the builder on `/` — and a Handle somebody typed into
 * the address bar is not a pick. It also keeps this page free of controls,
 * which its own test asserts as the tripwire for growing past its remit.
 */
function ResolvedHandle({
  handle,
  state,
}: {
  readonly handle: CanonicalHandle;
  readonly state: AvailabilityState;
}) {
  const spoken = spokenHandle(handle.emoji.map((entry) => entry.emoji));
  // The route canonicalised this segment, so the domain cannot honestly answer
  // `not-a-handle` about it. If it somehow does, say so honestly rather than
  // guessing "available" — which is the defect #68 reported.
  const resolved: ResolvedState = state === "not-a-handle" ? "unknown" : state;

  return (
    <main className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-24">
      <div className="text-center">
        <h1 className="text-6xl sm:text-7xl mb-8 tracking-tight">
          <span role="img" aria-label={spoken ?? handle.key}>
            {handle.key}
          </span>
        </h1>
        <p className="text-lg text-slate-500">{AVAILABILITY_COPY[resolved]}</p>
      </div>
    </main>
  );
}
