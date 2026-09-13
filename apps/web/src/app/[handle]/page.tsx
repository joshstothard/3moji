import { notFound, permanentRedirect } from "next/navigation";
import {
  canonicalise,
  resolveAlias,
  spokenHandle,
  type CanonicalHandle,
  type Profile,
  type ProfileLink,
  type ProfileState,
} from "@template/core";
import { readAvailability } from "../../lib/availability";
import { readProfile } from "../../lib/profile";
import { safeLinkHref } from "../../lib/safe-link";
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
  const state = await readAvailability(result.encoded);
  const profile = await readProfile(result.encoded, state);

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
 * bar — points at the emoji path instead (decision 5).
 *
 * **Several matches are a listing, and the listing is
 * [#109](https://github.com/joshstothard/3moji/issues/109).** Until it exists
 * this says so in one line and shows nothing: a listing rendered ahead of its
 * own issue would be the half of it that leaks Handles nobody claimed.
 */
async function AliasedHandle({ segment }: { readonly segment: string }) {
  const alias = resolveAlias(segment);
  if (!alias.ok) {
    // Not three dot-separated terms, or a word we do not know. Both are the
    // same answer over HTTP as the four canonicalisation rejections above:
    // there is no Handle at this URL.
    notFound();
  }

  // Independent reads, so they go together rather than one after another. The
  // worst alias measured by ADR-0008 (`celebration`, four emoji) is 64 of
  // them; the listing issue owns whatever bound that eventually needs.
  const matches = await Promise.all(
    alias.candidates.map(async (candidate) => ({
      candidate,
      state: await readAvailability(candidate.encoded),
    })),
  );

  const claimed = matches.filter((match) => match.state === "claimed");
  // Exactly one claimed match is the Profile to show. Failing that, an alias
  // that names exactly one Handle still has a page — unclaimed, held, reserved
  // or unknown, whatever the read says — and it is the same page the emoji
  // path renders. `at` rather than `[0]`, so nothing here asserts non-null.
  const shown =
    claimed.length === 1
      ? claimed.at(0)
      : matches.length === 1
        ? matches.at(0)
        : undefined;

  if (shown === undefined) {
    return <AmbiguousAlias />;
  }

  /*
   * The Profile read, and **one of them, after the decision rather than with
   * the availability reads**. It is the same second read the emoji path makes
   * (§ The claimed Handle), handed the same percent-encoded segment the
   * availability read was asked about, so the two answers cannot be about
   * different Handles. Folding it into the `Promise.all` above would fetch a
   * Profile for every candidate — doubling a cost ADR-0008 measured at 64
   * reads in the worst case — to show exactly one.
   */
  const profile = await readProfile(shown.candidate.encoded, shown.state);

  return (
    <>
      {/*
       * An alias is ambiguous by construction and so can never be canonical:
       * one indexable URL per Profile, and it is the emoji one. React hoists
       * this into the document head; `generateMetadata` would be the other
       * place to put it, and would re-run the resolver and every read above to
       * produce one string.
       */}
      <link rel="canonical" href={`/${shown.candidate.encoded}`} />
      <ResolvedHandle
        handle={shown.candidate}
        state={shown.state}
        profile={profile}
      />
    </>
  );
}

/**
 * An alias that could be more than one Handle.
 *
 * It says so and stops. No emoji, no Handles, no controls: which of them to
 * show — and the privacy and ranking questions an index of Profiles brings —
 * is [#109](https://github.com/joshstothard/3moji/issues/109), and a listing
 * improvised here would answer those questions by accident.
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
  readonly handle: RenderedHandle;
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
  readonly handle: RenderedHandle;
  readonly spoken: string | undefined;
}) {
  return (
    <main className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-24">
      <div className="text-center">
        <HandleHeading handle={handle} spoken={spoken} />
        <SpokenLine spoken={spoken} />
        <p className="mt-4 text-lg text-slate-500">{copy.unedited}</p>
      </div>
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
 */
function ProfilePage({
  handle,
  spoken,
  profile,
}: {
  readonly handle: RenderedHandle;
  readonly spoken: string | undefined;
  readonly profile: Profile;
}) {
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
