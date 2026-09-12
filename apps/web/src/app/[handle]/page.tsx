import { notFound, permanentRedirect } from "next/navigation";
import {
  canonicalise,
  spokenHandle,
  type CanonicalHandle,
} from "@template/core";
import { readAvailability } from "../../lib/availability";
import { HandleBuilder } from "../../components/handle-builder";
import { checkAvailability } from "../../components/availability-action";
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
 * The answers that are a statement and nothing more.
 *
 * `available` is excluded because it is the one answer that is **not** a
 * statement: an unclaimed Handle renders the builder, holding those three
 * emoji, and the live line under the slots is then the builder's own — which is
 * why "This Handle is available." has left this page's namespace entirely.
 */
type StatedState = Exclude<ResolvedState, "available">;

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
const AVAILABILITY_COPY: Readonly<Record<StatedState, string>> = {
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
 * **Unclaimed is the one answer that is not a line.** Somebody who typed a
 * Handle into the address bar has already told us what they want, so `/🧊🧊🧊`
 * renders the home page's builder holding those three emoji and invites the
 * claim ([#105](https://github.com/joshstothard/3moji/issues/105), and
 * `docs/architecture/data-model.md` § Profile, which has said so since Phase 2).
 * The other four answers stay a statement, and **two of them must**: a Reserved
 * Handle can never be claimed, so offering to claim it would be
 * [#68](https://github.com/joshstothard/3moji/issues/68) in a new form, and
 * `unknown` means the read failed — it cannot know the Handle is free.
 *
 * Swap suggestions are still not this page's business. They belong to the
 * builder, which now brings its own.
 */
function ResolvedHandle({
  handle,
  state,
}: {
  readonly handle: CanonicalHandle;
  readonly state: AvailabilityState;
}) {
  const emoji = handle.emoji.map((entry) => entry.emoji);
  const spoken = spokenHandle(emoji);
  // The route canonicalised this segment, so the domain cannot honestly answer
  // `not-a-handle` about it. If it somehow does, say so honestly rather than
  // guessing "available" — which is the defect #68 reported.
  const resolved: ResolvedState = state === "not-a-handle" ? "unknown" : state;

  if (resolved === "available") {
    return (
      <main className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
        <HandleHeading handle={handle} spoken={spoken} />
        <p className="text-center text-lg text-slate-500">{copy.unclaimed}</p>
        {/*
         * The builder, not a copy of it. `checkAvailability` is the same server
         * action the home page injects, over the same `lib/availability.ts`
         * read this page just made, so the live line under the slots cannot
         * disagree with the answer that put the builder here.
         */}
        <HandleBuilder
          checkAvailability={checkAvailability}
          initialEmoji={emoji}
        />
      </main>
    );
  }

  return (
    <main className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-24">
      <div className="text-center">
        <HandleHeading handle={handle} spoken={spoken} />
        <p className="text-lg text-slate-500">{AVAILABILITY_COPY[resolved]}</p>
      </div>
    </main>
  );
}

/**
 * The Handle itself, large.
 *
 * The emoji carry the meaning, so they are the heading, and `role="img"` with
 * the Spoken Name as the accessible name is what makes it announce as "three
 * ice cubes" rather than as three code points read out one by one.
 */
function HandleHeading({
  handle,
  spoken,
}: {
  readonly handle: CanonicalHandle;
  readonly spoken: string | undefined;
}) {
  return (
    <h1 className="text-6xl sm:text-7xl mb-8 tracking-tight text-center">
      <span role="img" aria-label={spoken ?? handle.key}>
        {handle.key}
      </span>
    </h1>
  );
}
