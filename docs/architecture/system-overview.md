# System overview

## Shape

A Turborepo monorepo on npm workspaces. Everything is TypeScript in strict mode.

`apps/web` is the only application that will be deployed ([ADR-0006](../adr/0006-nextjs-on-vercel-is-the-whole-application.md)). Route handlers and server actions are thin transport adapters over `packages/core`, which holds the domain logic and must import no framework.

| Path                                                | What it is                                                                                                                                                 | Port |
| --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- |
| `apps/web`                                          | Next.js (App Router) frontend and backend. A placeholder home page; the real one arrives with the Handle builder                                           | 3000 |
| `packages/core`                                     | **Planned, not yet built:** framework-free domain logic, use cases, and Zod schemas ([ADR-0006](../adr/0006-nextjs-on-vercel-is-the-whole-application.md)) | —    |
| `packages/shared`                                   | Types, Zod schemas, and constants shared across the workspace                                                                                              | —    |
| `packages/ui`                                       | Shared React component library (stub)                                                                                                                      | —    |
| `packages/test-utils`                               | Shared test helpers                                                                                                                                        | —    |
| `packages/tsconfig`, `eslint-config`, `jest-config` | Shared tooling presets                                                                                                                                     | —    |

## Communication

**Today:** there is one application. `apps/api` has been deleted ([ADR-0006](../adr/0006-nextjs-on-vercel-is-the-whole-application.md)), so nothing runs on port 3001 and no cross-process call remains. There is no database yet.

**Planned** ([ADR-0006](../adr/0006-nextjs-on-vercel-is-the-whole-application.md)): that cross-process call disappears. The web app talks to `packages/core` in-process, and `packages/core` talks to Neon Postgres through Drizzle using **`node-postgres` in every environment** — the same driver locally, in CI and in production, so CI exercises what production runs ([ADR-0010](../adr/0010-use-one-postgres-driver-in-every-environment.md)). Migrations run from committed files in the Vercel build step against the unpooled connection, with a database branch per preview deployment. No schema change is applied by hand.

## Routing

**Partly built.** Four routes exist: the Handle builder at `/`, Better Auth's whole HTTP surface at `/api/auth/[...all]`, the Handle route at `/[handle]` — the product's canonical URL, `3moji.me/🧊🧊🧊` — and the owner's edit surface at `/[handle]/edit`.

### The home page

`apps/web/src/app/page.tsx` is a server component that holds no state and fetches nothing. Its whole job is composition: it hands `HandleBuilder` the availability read and lets the builder own the interaction.

The builder is a client component, and it reaches the domain through **`@template/core/browser`** — a second entry point that exists because the root barrel re-exports `db/client` and so cannot be bundled for a browser (`next build` fails with `Can't resolve 'dns'`, `'fs'`, `'net'`, `'tls'` and `'util/types'`). That subpath is a deliberate allowlist of pure functions and frozen Emoji Set data; `packages/core/src/browser.test.ts` walks its transitive imports and fails if anything under `db/`, `auth/`, `ports/` or `adapters/` appears. Adding a name to it is a decision, not a convenience.

The tagline and the URL preview come from the domain rather than from the UI: `spokenHandle` collapses runs in order, and `canonicalise` produces the percent-encoded segment the availability read is asked about — the same one `/[handle]` would receive.

**Availability is read lazily, through a server action, and never on the render path.** `lib/services.ts` throws unless all five of `DATABASE_URL`, `RESEND_API_KEY`, `RESEND_FROM`, `BETTER_AUTH_URL` and `BETTER_AUTH_SECRET` are set, so a page that resolved services while rendering would 500 on a fresh clone and in CI's E2E job. Instead `/` prerenders as static content, and `checkAvailability` runs only once a visitor has filled three slots. Every failure on that path — a missing variable, a refused connection — is caught rather than reaching the page as a rejection, and answers with **whatever the pure domain still knows**: a Reserved Handle is still reserved, something that is not a Handle is still not one, and only the three ownership-dependent states degrade to `"unknown"`. So until an environment has those five variables, a claimable Handle reads "We could not check this Handle just now" while 🍕🍕🍕 and 🔪🔪🔪 read "This Handle cannot be claimed." — the [#68](https://github.com/joshstothard/3moji/issues/68) distinction, held on a clone with no database at all. **That wording is the builder's, and the route's differs deliberately:** the same state reads "This Handle is reserved." under § The Handle route below, because each surface has its own i18n namespace and they answer different questions — "can I have this?" against "what is this page?". Neither names a reason.

The picker in front of that grid is **one toggle button per entry of `RELEASED_CATEGORIES`, plus a search field** — 307 emoji is too many to scroll blindly. The category controls are derived from the released list in its own order, so the next drop (ADR-0007 decision 5) needs no change in `apps/web`. They are toggle buttons rather than a `role="tab"` tablist on purpose: search runs through `searchEmoji`, which spans the whole released set, so during a search no category's content is showing and `aria-selected="true"` on one tab would be a false statement where `aria-pressed="false"` on all of them is a true one. Picking a category clears the search, and a search nobody matches says so rather than rendering an empty grid.

**When the answer is taken, held or reserved, the builder offers three swaps** rather than leaving a dead end: `swapSuggestions` in `packages/core` replaces one emoji with another from the **same Unicode group** ([ADR-0005](../adr/0005-the-emoji-set.md) decision 4 — colour was rejected as an axis because it cannot be derived), deterministically, never offering the pick itself or a Reserved Handle. It promises "well-formed and not Reserved", not "free": proving free would be one database read per suggestion, on a path that exists to be instant. `"unknown"` deliberately offers none — the Handle may well be available, and swapping away from it would be its own small lie.

Every control in the builder is permanent: one button per slot for the life of the page, relabelled when it fills and when it clears. That is an accessibility requirement rather than a styling choice — swapping the control unmounts the focused node and drops focus to `<body>` — and `aria-disabled` is used throughout in place of `disabled`, which would take a button out of the tab order under a keyboard user's feet.

A swap suggestion is the one control that **cannot** be permanent: taking it makes the Handle no longer the taken one, so the button unmounts by its own success. Focus is therefore moved deliberately, to the slot whose emoji changed — which is why `SwapSuggestion` carries that position rather than leaving the UI to diff two keys, a diff that cannot tell 🍕🌮🍕 from 🍕🍕🌮. A test asserts focus lands on that slot and not on `<body>`, and it was observed failing without the move.

### The Handle route

`apps/web/src/app/[handle]/page.tsx` is a thin transport adapter: it hands the received path segment to `canonicalise` in `packages/core`, asks `lib/availability.ts` what is true about the Handle, and formats the answer. It holds no canonicalisation logic and decides nothing about availability itself.

| `canonicalise` says           | The route answers                                                                                                                          |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| not a Handle, for any reason  | the segment gets its second chance as a **word alias** (§ below); anything that is not one is `notFound()` — 404. Junk is never redirected |
| a Handle, spelled oddly       | `permanentRedirect("/" + encoded)` — 308 to the canonical path                                                                             |
| a Handle, spelled canonically | 200: the Profile if it is claimed, the builder if it is free, an honest line otherwise                                                     |

Two constraints from [the emoji URL report](../reports/2026-09-11-emoji-urls.md) bind any future work on this route, and both were re-confirmed against the pinned Next.js version:

- **`params` arrives percent-encoded.** `/🧊🧊🧊` and `/%F0%9F%A7%8A…` reach the page as the same 36-character encoded string. Next.js also upper-cases the escapes, so a lower-case-hex request is already canonical; the spelling that genuinely differs is a stray variation selector.
- **A redirect target is always the encoded form.** A raw emoji in a `Location` header fails Node's header validation with `ERR_INVALID_CHAR` and serves a 500.

A malformed escape such as `/%F0%9F` never reaches the page: Next.js rejects it first, with 400 in dev and 500 in production.

**The dynamic segment is one segment, not a catch-all**, so it cannot claim `/api/auth/...` or any other multi-segment path. An end-to-end test asserts that, because `[...handle]` would compile, match those paths and 404 them.

That line comes from `lib/availability.ts`, the one availability read, shared with the builder's server action so the two surfaces cannot drift. It is a Handle's state and nothing more: **available, taken, on hold, reserved, or "we could not check this Handle just now"**. A reserved Handle — `/🍕🍕🍕`, `/🔪🔪🔪` — resolves rather than 404ing, and says neither which kind of reservation it is nor, when held, who holds it or until when: the read answers with a state name, so neither the `Reservation` nor an expiry ever crosses out of `packages/core` to be rendered by accident ([#68](https://github.com/joshstothard/3moji/issues/68), ADR-0004). Two states are the exception, and neither is a line. **Unclaimed** renders the builder, holding those three emoji ([#105](https://github.com/joshstothard/3moji/issues/105)) — see § The unclaimed Handle below. **Claimed** renders the Profile ([#104](https://github.com/joshstothard/3moji/issues/104)) — see § The claimed Handle below.

**The read runs after both early exits, and degrades rather than failing.** `notFound()` and `permanentRedirect()` signal by throwing, so the read — which has a `try/catch` of its own — sits below them; catching around them would swallow the 404 and the 308. When `lib/services.ts` cannot be built (a clone with no environment, CI's E2E job with one variable of five), the read falls back to `claimableHandle`, which is pure: _reserved_ and _not a Handle_ still answer with certainty, and only the three ownership-dependent states degrade to "unknown".

**Swap suggestions belong to the builder, not to this route.** When the builder's pick comes back taken, held or reserved, it offers three alternatives from `swapSuggestions` in `packages/core` — each replacing one emoji with another from the **same Unicode group** ([ADR-0005](../adr/0005-the-emoji-set.md) decision 4), deterministic, never a Reserved Handle, and never the pick itself. It promises "well-formed and not Reserved", not "free": proving free would be a database read per suggestion. Taking a suggestion replaces the whole Handle and **moves focus to the slot that changed**, because the suggestion button that had focus is unmounted by its own success. A Handle typed into the address bar is not a pick, so `/[handle]` offers no suggestions of its own — but when the Handle is unclaimed it renders the builder, which brings its own (§ The unclaimed Handle). For the four answers that are a line, the route stays free of controls, and its test counts buttons as the tripwire for growing past its remit. The builder on `/` still offers no Claim of its own — that is #81's own route.

### The unclaimed Handle

`/🧊🧊🧊` with nobody holding it renders **the home page's builder, pre-filled**. Somebody who typed a Handle into the address bar has already made the pick, so the page opens on it: three full slots, the spoken tagline, the live URL preview, the category tabs and search, and one line inviting the claim. `docs/architecture/data-model.md` § Profile has described this since Phase 2.

**It is the same component, not a second one.** `HandleBuilder` grew one optional prop — `initialEmoji`, applied through a lazy `useState` initialiser so a re-render cannot throw away what the visitor has picked since — and the route passes the emoji `canonicalise` already returned. A forked builder would have drifted within a week, and would have taken the permanent-control focus behaviour with it; the route's own suite therefore re-asserts #78's focus regression and #79's category tabs against the real builder rendered from this route.

The availability read is the same `checkAvailability` server action the home page injects, over the same `lib/availability.ts` the route just called, so the live line under the slots cannot disagree with the answer that put the builder on the page.

**Four answers must not render it, and two of those are defects if they ever do.** Taken and held are somebody else's Handle. **Reserved** can never be claimed, so inviting a claim would be [#68](https://github.com/joshstothard/3moji/issues/68) in a new form. **`unknown`** means the read failed — it cannot know the Handle is free, and on a machine with no database _every_ claimable Handle answers `unknown`, so a builder rendered there would be an invitation issued on no evidence at all. The route holds this in the type: its copy `Record` is keyed on the resolved states **with `available` excluded**, and "This Handle is available." has left the `HandlePage` namespace entirely — the wording now belongs to the builder, which owns the live line. The unit suite counts controls rather than copy (the builder _is_ buttons: three slots and 307 emoji), and asserts zero of them for all four.

### The claimed Handle

`/🧊🧊🧊` with an owner behind it renders **the Profile** — the page the product exists to show ([#104](https://github.com/joshstothard/3moji/issues/104)). The shape of the three states, the field-by-field rules and the Link safety are in [data-model.md](data-model.md) § Profile; what belongs here is the routing.

**It is a second read, and it runs only when the first answered `claimed`.** `lib/availability.ts` stays exactly what it was — one state name, shared with the builder's server action — and `lib/profile.ts` sits beside it, composing that answer with `ProfileRepository.profileOf` through the pure `profileStateOf`. Both reads are handed the **same percent-encoded segment**, so the two answers cannot be about different Handles. The 404 and the 308 still run before either of them.

**Nothing widened to carry a Profile through.** `AvailabilityState` is still `HandleAvailability["state"] | "unknown"`, so the `Reservation` and the hold expiry still never leave `packages/core` ([#80](https://github.com/joshstothard/3moji/issues/80)). The Profile arrives as its own value, on its own read, gated on `claimed` three times over: `readProfile` issues no query otherwise, `profileStateOf` composes nothing otherwise, and the route's branch is nested under `claimed`. The unit suite forces the hostile case — a fully-populated Profile pushed at the page for a held, reserved and unknown Handle — and asserts the page still shows nothing but its line, because "I did not render it" is not evidence and a future debug view is exactly how this leaks.

**A failed Profile read degrades to the line, not to an empty page.** `lib/services.ts` needs five environment variables, so on a clone with none the availability read already answers `unknown` and no Profile is ever fetched; when the Handle _is_ claimed and the Profile read fails anyway, the answer is `none` and the route falls back to "This Handle is taken." — never `unedited`, which would be a statement about an owner the query never reached.

### Editing the Profile

`/🧊🧊🧊/edit` is the owner's surface ([#106](https://github.com/joshstothard/3moji/issues/106)): the display name, the bio, and a list of Links that can be added to, changed, removed and **reordered** ([#107](https://github.com/joshstothard/3moji/issues/107)). The row order **is** the order — `position` is the array index, written by the same save.

**Reordering is one rule reached two ways.** `moveLink` in `packages/core` (`src/profile/reorder-links.ts`) takes a list and a pair of indices and answers with the rearranged list; the move-up/move-down buttons and the drag handle both hand it a pair, so the keyboard path and the pointer path cannot produce different orders. It is exported from `@template/core/browser` — the client-bundle allowlist — because the rearranging happens in the form before anything is submitted.

**The keyboard path is the requirement, and dragging is the addition.** A drag-only reorder fails WCAG 2.1.1 outright: a keyboard user cannot perform it at all. So each row carries two real `<button>`s naming the Link's current position ("Move link 2 up"), and the drag handle beside them is `aria-hidden` and unfocusable — it offers nothing to assistive technology that the buttons do not already offer, and offering a control that cannot be activated is worse than offering none. The buttons at the ends of the list are `aria-disabled`, never `disabled`: a control that disables itself when pressed drops focus to `<body>`, which is what turns "move this Link to the top" into tabbing back from the top of the page after every press. Pressing one says so instead ("Home is already first."). Every move is announced in a `role="status"` region that is present and empty from the first render — a live region added at the moment it has something to say is not observed in time to announce it.

**Two reorders in quick succession compose, because a move names the Link and not the slot.** The state setter is functional, so the second move is applied to the first's result rather than to the list that render closed over; and the index is looked up inside the updater from the row's client-side id. A handler carrying the index it was rendered at would, on the second of two presses before a re-render, move whatever Link had arrived in that slot — pressing "move up" twice would move a Link up and then straight back down.

**Nothing about persistence changed, and no migration was needed.** The reordered list is posted by the existing `saveProfileAction`, which replaces the whole Link list inside one transaction (delete, then insert with `position` as the array index) and `revalidatePath`s before redirecting — so a reorder revalidates the cache exactly as every other edit does. Writing positions one row at a time would have collided with `UNIQUE (user_id, position)` the moment two Links swapped; rewriting the list whole is what makes that unreachable.

It canonicalises its segment exactly as `/[handle]` does, and redirects a non-canonical spelling to `/{encoded}/edit` rather than to the Profile, so an oddly-spelled URL does not silently drop the owner out of the form they asked for.

**It knows the emoji grammar only**, deliberately: `/ice-cube.ice-cube.ice-cube/edit` 404s. The word alias exists so a Handle can be **shared** as ASCII (§ The word alias), and an owner reaches their own form from their own Profile rather than from a link somebody sent them — so the ambiguity an alias carries has no business anywhere near a write. A route that resolved a candidate set here would have to decide which of eight Handles an owner meant to edit, which is exactly the guess ADR-0008 exists to refuse.

**Authorisation is two independent layers, and the action's is the one that matters.** The page decides whether a form is rendered; `saveProfileAction` decides whether a write happens, and it enforces the rule itself rather than trusting that the form was ever shown — a server action is a public HTTP endpoint, so it can be posted to directly, with any Handle in the body, by anyone holding a session cookie. The rule is `profileEditAuthority` in `packages/core`, pure and composed by `lib/profile-edit.ts` from two server-side facts: who the **session** says is asking (`lib/session.ts`, the one place an identity enters the application) and what the Account directory says that id owns. The Handle in the request is the thing compared, never the thing trusted.

It refuses four ways — signed out, no Handle, a Claim that is not final, and the Handle being somebody else's. The page sends the first to `/sign-in` and answers the rest `notFound()`, which says nothing about whether the Handle exists or who owns it; the action collapses all four into one `forbidden`. **The middle case is the one an authorisation bug actually reaches**: `profile.user_id` is the primary key, so a write derived from the session with no comparison would not fail loudly — it would quietly rewrite the requester's _own_ Profile while they were asking about somebody else's.

**Failing to read is refusing.** `lib/services.ts` needs five environment variables and every read here can be refused; each such failure answers "not signed in" or "owns nothing" rather than an error, because "we could not check" must never open an edit form. The same caution runs the other way for the Profile itself: a Profile that could not be **read** renders a notice instead of a blank form, since blanks offered to an owner are an invitation to save them over content that is still there, and the write replaces the whole Link list.

**A rejected save keeps what was typed and says what to fix.** The limits are `validateProfile`'s and are not restated in the form: the action passes the draft to `editProfile`, and the form renders the violations that come back — each one associated with its own control by `aria-invalid` and `aria-describedby`, since a message merely sitting beside an input is invisible to a screen reader. The numbers in the messages are the violation's own, so a limit that moves in the domain moves here with it.

**The save revalidates before it redirects**, in that order: without busting the cache first, Next serves the cached Handle page and the edit appears not to have taken effect (`docs/development/engineering-standards.md` § Frontend). The path is the percent-encoded segment, never the raw key.

**There is no link to it from the public Handle page yet**, and that is deliberate rather than forgotten: rendering an owner-only control there means reading the session on the most-read page in the product, which makes it per-visitor and uncacheable. An owner reaches the form by URL until that trade-off is decided.

### The word alias

**Built** ([ADR-0008](../adr/0008-handles-are-addressable-by-emoji-and-by-their-word-alias.md)), apart from one gap the ADR does not answer — see the end of this section. The resolver is `resolveAlias` in `packages/core/src/handle/alias.ts` and the dispatch is in `apps/web/src/app/[handle]/page.tsx`. The emoji URL cannot be shared: an autolinker truncates a path at the first non-ASCII byte, so `3moji.me/🧊🧊🧊` in a bio becomes a link to `3moji.me/` with the emoji orphaned beside it as text. Nothing server-side changes that — both spellings reach the browser as the same percent-encoded `location.pathname`.

So a Handle gets a second address: **three dot-separated term slugs**, `3moji.me/ice-cube.ice-cube.ice-cube`. The identity is unchanged — the alias is a derived lookup over the curated names, with no column and no migration.

**The separator is a dot because a hyphen is measurably ambiguous.** Slugging collapses non-alphanumerics to `-`, so a hyphen-joined form cannot say where one word ends: `curry-rice-wine-pizza` reads as `curry` + `rice-wine` + `pizza` _and_ as `curry-rice` + `wine` + `pizza`, both three emoji, so ADR-0004's exactly-three rule does not disambiguate. A dot cannot occur inside a slug, so the parse is unambiguous by construction.

Every position accepts any of that emoji's terms — the `displayName`, the CLDR `spokenName`, the plural and the synonyms, 937 distinct slugs over 307 emoji — so one Handle has many aliases and exactly one **canonical** alias (the `displayName` slugs, `canonicalAliasOf`). `resolveAlias` is pure and answers with a **candidate set**, never a Handle: it says which Handles the words could mean, and the route composes that with the availability read to find out which of them anybody has. The count of _claimed_ matches then decides:

| Claimed Handles matching | The route answers                                                                                       |
| ------------------------ | ------------------------------------------------------------------------------------------------------- |
| exactly one              | that Profile, rendered in place — **not** a redirect, so the shared ASCII link stays in the address bar |
| more than one            | a listing of the matches, each with its emoji and the owner's display name                              |
| none                     | the claim call to action                                                                                |

**The listing is built** ([#109](https://github.com/joshstothard/3moji/issues/109)). More than one claimed match renders a `<ul>` with an accessible name, one `<li>` per match, in the **resolver's candidate order** — not sorted by display name and not by recency, because ADR-0008 leaves ranking open and an order invented here would answer that question by accident, and would change under somebody between two visits. Each row is a single real `<a>` to that Handle's own emoji path, so the keyboard path is the browser's own: one tab stop per row, `Enter` to follow, a visible focus ring (WCAG 2.1.1 and 2.4.7). The row's accessible name is **computed from its content** rather than set with an `aria-label` — the Spoken Name, carried by `role="img"` so three code points are not read out one at a time, followed by the owner's display name, which is what actually tells 🍎🍎🍎 from 🍏🍏🍏 when the words cannot (decision 6). **No unique username is introduced** to help them. A claimed Handle whose owner has set no display name keeps its row and is announced by its Handle alone: the row exists because the Handle is somebody's, not because a field was filled in. Unclaimed and Reserved matches are omitted.

**The names cost one read, not one per row.** `lib/profile.ts` grew `readDisplayNames`, over a `ProfileRepository.displayNamesOf` that joins `handle` to `profile` and no further, so the page is **N availability reads + 1** — the same bound as the single-Profile case, and the reason the listing does not reuse `profileOf`, whose Link join returns up to eleven rows per Handle. It answers a map keyed on the percent-encoded segment, and an absent key is the whole of "no name to show". A failed read degrades to emoji-only rows rather than to no page: the names decorate the rows, the emoji are the identity.

**One case is still a single honest line, and it is not the listing's to answer.** An alias naming several Handles of which _none_ is claimed shows "Those words name more than one Handle…" and nothing else. The claim call to action is a page for one specific Handle, and `apple.apple.apple` with nothing claimed does not name one, so offering the builder there would mean guessing which of eight the visitor meant; a listing cannot cover it either, because ADR-0008 omits unclaimed Handles from a listing. Decision 4's `none` row assumes the alias names exactly one Handle, which is a gap in the ADR rather than in the implementation — resolving it needs a new ADR, since an accepted one cannot be edited. That is [#121](https://github.com/joshstothard/3moji/issues/121). The claim call to action is therefore still rendered only where the alias names exactly one Handle, which is the 96.8% case.

**"That Profile" is literally the Profile**, not a second rendering of one. Once the count has chosen a Handle to show, the alias path takes the same `lib/profile.ts` read and the same components as § The claimed Handle below — handed that candidate's own percent-encoded emoji segment, so the availability answer and the Profile cannot be about different Handles. It is **one** Profile read, issued after the choice rather than alongside the availability reads: a Profile per candidate would double a cost ADR-0008 measured at 64 reads in the worst case, to show exactly one. Where the alias shows no page, no Profile is read at all.

An alias page declares `rel="canonical"` pointing at the emoji path: an alias is ambiguous by construction and so can never be canonical. It is emitted only when exactly one Handle is being shown. A **listing** emits none — it has several emoji paths and picking one would assert a meaning the alias does not have — and neither does the line above, which shows no Handle at all.

Both grammars share the one root route, dispatching on the received segment: `canonicalise` runs first and unchanged, and only its failure reaches the resolver. So the emoji path's four rejection reasons and its 308 are untouched and still run before any database read, and an ASCII segment that is not three dot-separated terms still 404s. Dotted segments reach the route cleanly — asserted on the wire in `apps/web/e2e/handle-url.spec.ts`, which also pins the absence of a `Location` header on an alias that resolves. **Under `next dev` only:** whether Vercel's CDN treats a dotted path segment as a static-file request is still unverified, and needs a deployed environment ([#32](https://github.com/joshstothard/3moji/issues/32), blocked on [#19](https://github.com/joshstothard/3moji/issues/19)).

## Deployment

**Planned** ([ADR-0006](../adr/0006-nextjs-on-vercel-is-the-whole-application.md)): Vercel on the Hobby plan, which forbids commercial use. Postgres is Neon via the Vercel Marketplace; transactional email is Resend, sending from a subdomain of `3moji.me`.

## Areas

- [data-model.md](data-model.md) — Account, Handle, Profile, Link, and the Emoji Set
- [auth.md](auth.md) — sign-in, verification, and the gate on claiming a Handle

## Quality gates

Local hooks (Husky pre-commit and pre-push), `scripts/verify.sh`, and GitHub Actions (`.github/workflows/ci.yml`) run the same checks: agent-workflow parity, script unit tests, lint, typecheck, unit tests, build, ADR sync, and `npm audit`. Scheduled workflows (nightly mutation testing and security scans) run on demand only.

Pull requests merge themselves once CI passes ([ADR-0003](../adr/0003-auto-merge-pull-requests-on-green-ci.md)). `.github/workflows/auto-merge.yml` runs `scripts/auto-merge.mjs`, which merges a PR labelled `automerge`, or a Dependabot PR containing only minor and patch updates, when the latest CI run on its up-to-date head commit succeeded. The repository has no GitHub branch protection (not available on its plan), so that workflow is the merge gate.

## How work is tracked

Work is tracked in GitHub Issues on a GitHub Project board and planned in `docs/reports/`, `docs/adr/`, and `docs/workstreams/` ([ADR-0002](../adr/0002-track-work-in-github-issues.md)). All tracker calls go through `scripts/gh-workflow.mjs`. See [docs/development/github-workflow.md](../development/github-workflow.md).
