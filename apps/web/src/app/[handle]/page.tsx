import type { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";
import { cache } from "react";
import {
  canonicalise,
  resolveAlias,
  spokenHandle,
  type AliasCandidate,
  type CanonicalHandle,
  type Profile,
  type ProfileLink,
  type ProfileState,
} from "@template/core";
import { readAvailability } from "../../lib/availability";
import { readDisplayNames, readProfile } from "../../lib/profile";
import { safeLinkHref } from "../../lib/safe-link";
import { shareLinkOf, siteOrigin } from "../../lib/share-link";
import { genericMetadataOf, handleMetadataOf } from "../../lib/og/metadata";
import { HandleBuilder } from "../../components/handle-builder";
import { checkAvailability } from "../../components/availability-action";
import { claimFormAction } from "../../components/claim-action";
import { ShareLinkControl } from "../../components/share-link";
import { ReportLink } from "../../components/report-link";
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

/**
 * The reads, shared between {@link generateMetadata} and the page.
 *
 * Next.js calls both for one request, and each needs the same availability and
 * Profile answers. React `cache` memoises them for the duration of that
 * request, so the metadata costs no second query — and the card and the page
 * cannot disagree about a Handle whose state changed between two reads.
 */
const availabilityOf = cache(readAvailability);
const profileOf = cache(readProfile);

/**
 * The page's Open Graph card, canonical URL and Twitter card
 * ([#161](https://github.com/joshstothard/3moji/issues/161)).
 *
 * **It is the only place a canonical URL is emitted.** Every page showing one
 * Handle — reached by the emoji path or by the word alias — declares that
 * Handle's percent-encoded emoji path (ADR-0008 decision 5). A redirect, a 404,
 * a listing and an alias naming several Handles get the generic card and no
 * canonical. What each state's card may say is `lib/og/metadata.ts`'s.
 *
 * It never throws for control flow: the page below decides the 404 and the
 * 308, and metadata for a request that becomes one is never sent.
 */
export async function generateMetadata({
  params,
}: HandlePageProps): Promise<Metadata> {
  const { handle } = await params;
  const origin = siteOrigin();
  const result = canonicalise(handle);

  if (result.ok) {
    // Not gated on `isCanonical`. The page 308s another spelling before any
    // metadata is sent, so this only ever describes the canonical page — and
    // against a production build the segment reached here spelled differently
    // from the page's, which dropped the canonical URL from a page that had one.
    const state = await availabilityOf(result.encoded);
    const profile = await profileOf(result.encoded, state);
    return handleMetadataOf({ origin, handle: result, state, profile });
  }

  const choice = await aliasChoiceOf(handle);
  if (choice.kind !== "one") return genericMetadataOf(origin);

  const profile = await profileOf(choice.candidate.encoded, choice.state);
  return handleMetadataOf({
    origin,
    handle: choice.candidate,
    state: choice.state,
    profile,
  });
}

export default async function HandlePage({ params }: HandlePageProps) {
  const { handle } = await params;
  const result = canonicalise(handle);

  if (!result.ok) {
    // The segment is not an emoji Handle, so it gets its second chance as a
    // **word alias** ([ADR-0008](../../../../../docs/adr/0008-handles-are-addressable-by-emoji-and-by-their-word-alias.md)
    // decision 7: both grammars live on this one route). That ADR supersedes
    // exactly one clause of ADR-0004 decision 1 — "one that cannot be
    // canonicalised returns 404" — and nothing else: every rejection above ran
    // first and unchanged, the 308 with it, and an ASCII segment that is not
    // three dot-separated terms still 404s below. Junk is still never
    // redirected, and explaining it would only help a crawler index it.
    return await AliasedHandle({ segment: handle });
  }

  if (!result.isCanonical) {
    permanentRedirect(`/${result.encoded}`);
  }

  // Both early exits are above, and deliberately so: `notFound` and
  // `permanentRedirect` signal by throwing, so anything that catches around
  // them — and the read below has a `try/catch` inside it — would swallow the
  // 404 and the 308 and answer 200 with an availability line for junk.
  const state = await availabilityOf(result.encoded);
  const profile = await profileOf(result.encoded, state);

  return <ResolvedHandle handle={result} state={state} profile={profile} />;
}

const copy = en.HandlePage;

/**
 * What the Handle rendering below actually reads: a key to show and the three
 * entries behind it.
 *
 * A `Pick` of {@link CanonicalHandle} rather than a new interface, because both
 * grammars arrive here — the emoji path with a `CanonicalHandle`, the alias
 * path with an alias candidate — and an alias candidate is structurally a
 * `CanonicalHandle` **minus the routing fields**. Dropping `isCanonical` is the
 * point: it is a 308 answer about a received emoji segment, it is meaningless
 * for an alias, and a component that could read it is a component that could
 * redirect a page which must not redirect.
 */
type RenderedHandle = Pick<CanonicalHandle, "key" | "emoji">;

/**
 * A rendered Handle that can be reported: plus its percent-encoded canonical
 * path, which the report link names in its subject
 * ([#197](https://github.com/joshstothard/3moji/issues/197)). Both grammars
 * carry it, and it is still not `isCanonical`.
 */
type ReportableHandle = RenderedHandle & { readonly encoded: string };

/**
 * The word alias: `3moji.me/ice-cube.ice-cube.ice-cube`, the ASCII address of
 * the same Handle
 * ([ADR-0008](../../../../../docs/adr/0008-handles-are-addressable-by-emoji-and-by-their-word-alias.md)).
 *
 * The resolver in `packages/core` is pure and answers with a **candidate set**,
 * never a Handle: `apple` names both 🍎 and 🍏, so `apple.apple.apple` names
 * eight Handles and choosing one of them here would be inventing an answer.
 * What this function adds is the only thing the domain cannot know — which of
 * them anybody actually has — and the count is what decides the response
 * (decision 4).
 *
 * **One match renders in place. It must never redirect.** The whole reason the
 * alias exists is that the shared link is ASCII; a 308 to the emoji path would
 * replace it in the address bar with 45 characters of `%F0%9F…`, which is the
 * defect the ADR was written to avoid. So the Profile is rendered under the
 * alias URL, and `rel="canonical"` — which is for machines, not for the address
 * bar — points at the emoji path instead (decision 5). That link is emitted by
 * {@link generateMetadata}, not here, so there is exactly one.
 *
 * **More than one claimed match is a listing** (decision 4,
 * [#109](https://github.com/joshstothard/3moji/issues/109)): roughly one alias
 * in ten needs a disambiguating tap, and sending somebody to the wrong Profile
 * is worse than asking which they meant. Unclaimed and Reserved candidates are
 * omitted from it — a row exists because the Handle is somebody's.
 *
 * **Several candidates of which none is claimed is still the one honest line**,
 * and deliberately so. Decision 4's `none` row is the claim call to action,
 * which is a page for one specific Handle; `apple.apple.apple` with nothing
 * claimed does not name one, and a listing cannot cover it either because the
 * ADR omits unclaimed Handles from listings. That gap is
 * [#121](https://github.com/joshstothard/3moji/issues/121) and needs an ADR of
 * its own — an accepted ADR cannot be edited, so it is not resolved here.
 */
async function AliasedHandle({ segment }: { readonly segment: string }) {
  const choice = await aliasChoiceOf(segment);

  if (choice.kind === "unresolved") {
    // Not three dot-separated terms, or a word we do not know. Both are the
    // same answer over HTTP as the four canonicalisation rejections above:
    // there is no Handle at this URL.
    notFound();
  }

  if (choice.kind === "listing") {
    /*
     * The listing, and **one read for all of its names**. The rows are the
     * claimed matches in the resolver's order — not sorted by name and not by
     * recency, because ADR-0008 leaves ranking open and an order invented here
     * would answer it by accident.
     */
    const displayNames = await readDisplayNames(
      choice.listed.map((candidate) => candidate.encoded),
    );
    return (
      <AliasListing candidates={choice.listed} displayNames={displayNames} />
    );
  }

  if (choice.kind === "ambiguous") {
    return <AmbiguousAlias />;
  }

  /*
   * The Profile read, and **one of them, after the decision rather than with
   * the availability reads**. It is the same second read the emoji path makes
   * (§ The claimed Handle), handed the same percent-encoded segment the
   * availability read was asked about, so the two answers cannot be about
   * different Handles. Folding it into the availability reads would fetch a
   * Profile for every candidate — doubling a cost ADR-0008 measured at 64
   * reads in the worst case — to show exactly one.
   */
  const profile = await profileOf(choice.candidate.encoded, choice.state);

  return (
    <ResolvedHandle
      handle={choice.candidate}
      state={choice.state}
      profile={profile}
    />
  );
}

/** What an alias resolves to, once the availability reads have answered. */
type AliasChoice =
  | { readonly kind: "unresolved" }
  | { readonly kind: "listing"; readonly listed: readonly AliasCandidate[] }
  | { readonly kind: "ambiguous" }
  | {
      readonly kind: "one";
      readonly candidate: AliasCandidate;
      readonly state: AvailabilityState;
    };

/**
 * The decision ADR-0008 decision 4 makes about an alias, taken once per
 * request and shared by the page and {@link generateMetadata}.
 *
 * The resolver in `packages/core` answers with a candidate set; this adds which
 * of them anybody has. Independent reads, so they go together rather than one
 * after another. The worst alias measured by ADR-0008 (`celebration`, four
 * emoji) is 64 of them; the listing issue owns whatever bound that needs.
 *
 * Exactly one claimed match is the Handle to show. Failing that, an alias that
 * names exactly one Handle still has a page — unclaimed, held, reserved or
 * unknown, whatever the read says — and it is the same page the emoji path
 * renders. `at` rather than `[0]`, so nothing here asserts non-null.
 */
const aliasChoiceOf = cache(async (segment: string): Promise<AliasChoice> => {
  const alias = resolveAlias(segment);
  if (!alias.ok) return { kind: "unresolved" };

  const matches = await Promise.all(
    alias.candidates.map(async (candidate) => ({
      candidate,
      state: await availabilityOf(candidate.encoded),
    })),
  );

  const claimed = matches.filter((match) => match.state === "claimed");
  if (claimed.length > 1) {
    return { kind: "listing", listed: claimed.map((match) => match.candidate) };
  }

  const shown =
    claimed.length === 1
      ? claimed.at(0)
      : matches.length === 1
        ? matches.at(0)
        : undefined;

  if (shown === undefined) return { kind: "ambiguous" };
  return { kind: "one", candidate: shown.candidate, state: shown.state };
});

/**
 * One Handle as a listing shows it: what to render, and where it lives.
 *
 * {@link RenderedHandle} plus the one field a row needs that a rendered Handle
 * does not — the emoji path to link to. Still no `isCanonical`, for the reason
 * `RenderedHandle` drops it.
 */
type ListedHandle = RenderedHandle & { readonly encoded: string };

/**
 * The listing: the claimed Handles an alias could mean (ADR-0008 decision 4,
 * [#109](https://github.com/joshstothard/3moji/issues/109)).
 *
 * **It is a list, and the semantics are the accessibility.** A `<ul>` with an
 * accessible name announces "list, 8 items" and lets a screen reader user move
 * through it by item; a stack of `<div>`s announces nothing and is the usual
 * way a listing like this becomes unusable. Each row is one real `<a>`, so the
 * keyboard path is the browser's own — one tab stop per row, `Enter` to follow,
 * and a visible focus ring (WCAG 2.1.1 and 2.4.7).
 *
 * **The order is the resolver's.** ADR-0008 explicitly leaves ranking open, and
 * sorting by display name or by recency here would answer that question by
 * accident — and would make a listing whose order changed under somebody
 * between two visits.
 *
 * **No `rel="canonical"` is emitted.** Decision 5 points it at *the* emoji path;
 * a listing has several, and choosing one would assert a meaning the alias does
 * not have.
 */
function AliasListing({
  candidates,
  displayNames,
}: {
  readonly candidates: readonly ListedHandle[];
  readonly displayNames: ReadonlyMap<string, string>;
}) {
  return (
    <main className="max-w-2xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
      <div className="text-center">
        <h1 className="text-3xl sm:text-4xl mb-4 tracking-tight text-slate-900">
          {copy.aliasSeveralHeading}
        </h1>
        <p className="text-lg text-slate-500">{copy.aliasListing}</p>
      </div>
      <ul aria-label={copy.aliasListingLabel} className="mt-10 space-y-3">
        {candidates.map((candidate) => (
          <li key={candidate.key}>
            <AliasListingRow
              candidate={candidate}
              displayName={displayNames.get(candidate.encoded)}
            />
          </li>
        ))}
      </ul>
    </main>
  );
}

/**
 * One matching Handle, and its owner.
 *
 * **The accessible name is computed from the row's content**, deliberately, not
 * set with an `aria-label` on the anchor: a label would discard everything
 * inside it, so the owner's name would have to be repeated into it and could
 * then drift from what is on screen. As written the link announces "three red
 * apples, Ada Rose" — the Spoken Name, which is what stops three code points
 * being read out one at a time, plus the thing that actually distinguishes this
 * row from 🍏🍏🍏.
 *
 * **The display name is omitted when there is none**, rather than rendered as a
 * gap. A claimed Handle whose owner has never edited anything is still
 * somebody's and still belongs in the list; it is announced by its Handle
 * alone, which is exactly what `UneditedHandle` says on its own page.
 */
function AliasListingRow({
  candidate,
  displayName,
}: {
  readonly candidate: ListedHandle;
  readonly displayName: string | undefined;
}) {
  const spoken = spokenHandle(candidate.emoji.map((entry) => entry.emoji));

  return (
    <a
      href={`/${candidate.encoded}`}
      className="flex items-center gap-4 rounded-xl bg-white px-5 py-4 shadow-sm hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600"
    >
      <span
        className="text-4xl"
        role="img"
        aria-label={spoken ?? candidate.key}
      >
        {candidate.key}
      </span>
      {displayName !== undefined && (
        <span className="text-lg text-slate-900 break-words">
          {displayName}
        </span>
      )}
    </a>
  );
}

/**
 * An alias that could be more than one Handle, **none of which anybody has**.
 *
 * It says so and stops. No emoji, no Handles, no controls — and that is the
 * only branch left saying it, now that more than one claimed match renders
 * {@link AliasListing}. ADR-0008 omits unclaimed Handles from a listing, so
 * there is nothing here a listing may show; and the claim call to action is a
 * page for one specific Handle, which an alias naming eight does not give it.
 * Choosing between them is
 * [#121](https://github.com/joshstothard/3moji/issues/121), which needs its own
 * ADR — decision 4's `none` row assumes a single candidate, and an accepted ADR
 * cannot be edited.
 */
function AmbiguousAlias() {
  return (
    <main className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-24">
      <div className="text-center">
        <h1 className="text-3xl sm:text-4xl mb-8 tracking-tight text-slate-900">
          {copy.aliasSeveralHeading}
        </h1>
        <p className="text-lg text-slate-500">{copy.aliasSeveral}</p>
      </div>
    </main>
  );
}

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
  profile,
}: {
  readonly handle: ReportableHandle;
  readonly state: AvailabilityState;
  readonly profile: ProfileState;
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
        <p className="text-center text-lg text-slate-500">
          <span>{copy.unclaimed}</span>{" "}
          {/*
           * The call to action is a real control
           * ([#115](https://github.com/joshstothard/3moji/issues/115)); #105
           * left it as copy because there was nowhere to link to. It links
           * within the page, to the claim form the builder renders — `#claim`
           * is `claim-form.tsx`'s section id, repeated as a literal because an
           * export of a client module reaches a server component as a client
           * reference rather than a string. A link, not a button: it goes
           * somewhere, and the browser moves the focus starting point with it.
           */}
          <a
            className="font-semibold text-indigo-600 underline hover:text-indigo-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600"
            href="#claim"
          >
            {copy.unclaimedAction}
          </a>
        </p>
        {/*
         * The builder, not a copy of it. `checkAvailability` is the same server
         * action the home page injects, over the same `lib/availability.ts`
         * read this page just made, so the live line under the slots cannot
         * disagree with the answer that put the builder here. That read is
         * handed over as `initialAvailability`, so the claim form the link
         * above points at is on the page from the first paint.
         */}
        <HandleBuilder
          checkAvailability={checkAvailability}
          claim={claimFormAction}
          initialAvailability="available"
          initialEmoji={emoji}
        />
      </main>
    );
  }

  /*
   * **A Profile is shown for a claimed Handle and for nothing else, and the
   * guard is this `if` rather than a property of the value.**
   *
   * `readProfile` already refuses to fetch one for any other answer, and
   * `profileStateOf` already refuses to compose one. This is the third layer,
   * and it is here because it is the last one: a Profile is the first thing
   * this page renders that is not a state name, so it is the first thing that
   * could put a holder's name or a hold's expiry on a held Handle's page. #80
   * made that impossible in the type by keeping the `Reservation` and the
   * expiry inside `packages/core`; a debug view that handed this component a
   * Profile regardless of state is exactly how that seal would break, and the
   * `sealed states` suite forces the case.
   */
  if (resolved === "claimed") {
    if (profile.state === "profile") {
      return (
        <ProfilePage
          handle={handle}
          spoken={spoken}
          profile={profile.profile}
        />
      );
    }
    if (profile.state === "unedited") {
      return <UneditedHandle handle={handle} spoken={spoken} />;
    }
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
  readonly handle: RenderedHandle;
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
/**
 * How to say the Handle out loud, when there is a way to say it.
 *
 * `spokenHandle` answers `undefined` for anything outside the curated set, and
 * the line is **omitted** rather than rendered around a gap: "Say it:
 * undefined" is worse than silence, and a page that prints the word `undefined`
 * is the tell that a nullable value was interpolated without being checked.
 */
function SpokenLine({ spoken }: { readonly spoken: string | undefined }) {
  if (spoken === undefined) return null;

  return (
    <p className="text-lg text-slate-500">
      {copy.spoken.replace("{spoken}", spoken)}
    </p>
  );
}

/**
 * Claimed, and the owner has never edited anything.
 *
 * **A named state, not a Profile of blanks** (`data-model.md` § Profile). The
 * Handle is the whole of what there is to show, so it is shown the way the
 * product means it to be read — large, and with how to say it — rather than as
 * an empty name, an empty bio and an empty list of Links waiting to be filled.
 * The distinction is `profileStateOf`'s, and this component is why it exists.
 */
function UneditedHandle({
  handle,
  spoken,
}: {
  readonly handle: ReportableHandle;
  readonly spoken: string | undefined;
}) {
  return (
    <main className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-24">
      <div className="text-center">
        <HandleHeading handle={handle} spoken={spoken} />
        <SpokenLine spoken={spoken} />
        <p className="mt-4 text-lg text-slate-500">{copy.unedited}</p>
      </div>
      <ReportLink encoded={handle.encoded} />
    </main>
  );
}

/**
 * The page the product exists to show.
 *
 * **The emoji stay the `<h1>`.** The display name belongs to the owner, but the
 * Handle is what the page is *about* and what a screen reader should announce
 * first — as "three ice cubes", not as three code points — so the display name
 * is an `<h2>` under it. Promoting it would change what the page announces and
 * would leave the Handle unheaded.
 *
 * **Every field is optional.** `displayName` and `bio` are `null` for "never
 * set" (`src/db/profile.ts`), and an owner may well have saved Links and
 * nothing else. Each is omitted rather than rendered empty, for the reason
 * {@link SpokenLine} is.
 *
 * **It offers its canonical word alias link for sharing**
 * ([#160](https://github.com/joshstothard/3moji/issues/160), ADR-0008
 * decision 3), to every visitor, whichever grammar they arrived by. The link is
 * built here on the server and only the finished string crosses to the client
 * control. It is omitted when there is no configured origin or no alias, and it
 * is offered on this view alone: never on an unedited, held, reserved, unknown
 * or unclaimed Handle, and never on a listing.
 */
function ProfilePage({
  handle,
  spoken,
  profile,
}: {
  readonly handle: ReportableHandle;
  readonly spoken: string | undefined;
  readonly profile: Profile;
}) {
  const share = shareLinkOf(handle.emoji.map((entry) => entry.emoji));

  return (
    <main className="max-w-2xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
      <div className="text-center">
        <HandleHeading handle={handle} spoken={spoken} />
        <SpokenLine spoken={spoken} />
        {profile.displayName !== null && (
          <h2 className="mt-4 text-2xl font-semibold tracking-tight text-slate-900 break-words">
            {profile.displayName}
          </h2>
        )}
        {profile.bio !== null && (
          <p className="mt-3 text-lg text-slate-600 whitespace-pre-line break-words">
            {profile.bio}
          </p>
        )}
      </div>
      {profile.links.length > 0 && (
        <ul aria-label={copy.linksLabel} className="mt-10 space-y-3">
          {profile.links.map((link) => (
            <li key={link.id}>
              <ProfileLinkRow link={link} />
            </li>
          ))}
        </ul>
      )}
      {/*
       * After the owner's Links, so the first tab stop on a Profile is still the
       * owner's own content rather than a control of ours.
       */}
      {share !== undefined && <ShareLinkControl href={share.href} />}
      {/* Last of all (#197): reporting is for the few, sharing for everyone. */}
      <ReportLink encoded={handle.encoded} />
    </main>
  );
}

/** The shared look of a Link row, whether or not it is a link. */
const LINK_ROW =
  "block rounded-xl bg-white px-5 py-4 text-center shadow-sm break-words";

/**
 * One owner-supplied Link, rendered to a stranger.
 *
 * Two things are load-bearing here, and both are about the fact that the URL
 * and the title were typed by somebody else:
 *
 * - **`rel="noopener noreferrer"`** on every one, without exception.
 * - **The scheme is checked again at the render.** `validateProfile` refuses
 *   anything but `http:` and `https:` at the write, and this is the second,
 *   independent layer (`docs/development/engineering-standards.md` § Security,
 *   defence in depth). A Link whose scheme is refused keeps its title — that is
 *   the owner's content and React escapes it — but is rendered as **text with
 *   no `href` at all**, rather than as a link to nowhere.
 */
function ProfileLinkRow({ link }: { readonly link: ProfileLink }) {
  const href = safeLinkHref(link.url);

  if (href === undefined) {
    return <span className={`${LINK_ROW} text-slate-500`}>{link.title}</span>;
  }

  return (
    <a
      href={href}
      rel="noopener noreferrer"
      className={`${LINK_ROW} text-indigo-600 hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600`}
    >
      {link.title}
    </a>
  );
}
