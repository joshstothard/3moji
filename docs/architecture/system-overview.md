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

**Partly built.** Three routes exist: the Handle builder at `/`, Better Auth's whole HTTP surface at `/api/auth/[...all]`, and the Handle route at `/[handle]` — the product's canonical URL, `3moji.me/🧊🧊🧊`.

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
| a Handle, spelled canonically | 200, and one honest line about its availability                                                                                            |

Two constraints from [the emoji URL report](../reports/2026-09-11-emoji-urls.md) bind any future work on this route, and both were re-confirmed against the pinned Next.js version:

- **`params` arrives percent-encoded.** `/🧊🧊🧊` and `/%F0%9F%A7%8A…` reach the page as the same 36-character encoded string. Next.js also upper-cases the escapes, so a lower-case-hex request is already canonical; the spelling that genuinely differs is a stray variation selector.
- **A redirect target is always the encoded form.** A raw emoji in a `Location` header fails Node's header validation with `ERR_INVALID_CHAR` and serves a 500.

A malformed escape such as `/%F0%9F` never reaches the page: Next.js rejects it first, with 400 in dev and 500 in production.

**The dynamic segment is one segment, not a catch-all**, so it cannot claim `/api/auth/...` or any other multi-segment path. An end-to-end test asserts that, because `[...handle]` would compile, match those paths and 404 them.

That line comes from `lib/availability.ts`, the one availability read, shared with the builder's server action so the two surfaces cannot drift. It is a Handle's state and nothing more: **available, taken, on hold, reserved, or "we could not check this Handle just now"**. A reserved Handle — `/🍕🍕🍕`, `/🔪🔪🔪` — resolves rather than 404ing, and says neither which kind of reservation it is nor, when held, who holds it or until when: the read answers with a state name, so neither the `Reservation` nor an expiry ever crosses out of `packages/core` to be rendered by accident ([#68](https://github.com/joshstothard/3moji/issues/68), ADR-0004). The unclaimed state is the exception, and the one answer that is not a line: it renders the builder, holding those three emoji ([#105](https://github.com/joshstothard/3moji/issues/105)) — see § The unclaimed Handle below.

**The read runs after both early exits, and degrades rather than failing.** `notFound()` and `permanentRedirect()` signal by throwing, so the read — which has a `try/catch` of its own — sits below them; catching around them would swallow the 404 and the 308. When `lib/services.ts` cannot be built (a clone with no environment, CI's E2E job with one variable of five), the read falls back to `claimableHandle`, which is pure: _reserved_ and _not a Handle_ still answer with certainty, and only the three ownership-dependent states degrade to "unknown".

**Swap suggestions belong to the builder, not to this route.** When the builder's pick comes back taken, held or reserved, it offers three alternatives from `swapSuggestions` in `packages/core` — each replacing one emoji with another from the **same Unicode group** ([ADR-0005](../adr/0005-the-emoji-set.md) decision 4), deterministic, never a Reserved Handle, and never the pick itself. It promises "well-formed and not Reserved", not "free": proving free would be a database read per suggestion. Taking a suggestion replaces the whole Handle and **moves focus to the slot that changed**, because the suggestion button that had focus is unmounted by its own success. A Handle typed into the address bar is not a pick, so `/[handle]` offers no suggestions of its own — but when the Handle is unclaimed it renders the builder, which brings its own (§ The unclaimed Handle). For the four answers that are a line, the route stays free of controls, and its test counts buttons as the tripwire for growing past its remit. The builder on `/` still offers no Claim of its own — that is #81's own route.

### The unclaimed Handle

`/🧊🧊🧊` with nobody holding it renders **the home page's builder, pre-filled**. Somebody who typed a Handle into the address bar has already made the pick, so the page opens on it: three full slots, the spoken tagline, the live URL preview, the category tabs and search, and one line inviting the claim. `docs/architecture/data-model.md` § Profile has described this since Phase 2.

**It is the same component, not a second one.** `HandleBuilder` grew one optional prop — `initialEmoji`, applied through a lazy `useState` initialiser so a re-render cannot throw away what the visitor has picked since — and the route passes the emoji `canonicalise` already returned. A forked builder would have drifted within a week, and would have taken the permanent-control focus behaviour with it; the route's own suite therefore re-asserts #78's focus regression and #79's category tabs against the real builder rendered from this route.

The availability read is the same `checkAvailability` server action the home page injects, over the same `lib/availability.ts` the route just called, so the live line under the slots cannot disagree with the answer that put the builder on the page.

**Four answers must not render it, and two of those are defects if they ever do.** Taken and held are somebody else's Handle. **Reserved** can never be claimed, so inviting a claim would be [#68](https://github.com/joshstothard/3moji/issues/68) in a new form. **`unknown`** means the read failed — it cannot know the Handle is free, and on a machine with no database _every_ claimable Handle answers `unknown`, so a builder rendered there would be an invitation issued on no evidence at all. The route holds this in the type: its copy `Record` is keyed on the resolved states **with `available` excluded**, and "This Handle is available." has left the `HandlePage` namespace entirely — the wording now belongs to the builder, which owns the live line. The unit suite counts controls rather than copy (the builder _is_ buttons: three slots and 307 emoji), and asserts zero of them for all four.

### The word alias

**Built**, apart from the listing ([ADR-0008](../adr/0008-handles-are-addressable-by-emoji-and-by-their-word-alias.md)). The resolver is `resolveAlias` in `packages/core/src/handle/alias.ts` and the dispatch is in `apps/web/src/app/[handle]/page.tsx`. The emoji URL cannot be shared: an autolinker truncates a path at the first non-ASCII byte, so `3moji.me/🧊🧊🧊` in a bio becomes a link to `3moji.me/` with the emoji orphaned beside it as text. Nothing server-side changes that — both spellings reach the browser as the same percent-encoded `location.pathname`.

So a Handle gets a second address: **three dot-separated term slugs**, `3moji.me/ice-cube.ice-cube.ice-cube`. The identity is unchanged — the alias is a derived lookup over the curated names, with no column and no migration.

**The separator is a dot because a hyphen is measurably ambiguous.** Slugging collapses non-alphanumerics to `-`, so a hyphen-joined form cannot say where one word ends: `curry-rice-wine-pizza` reads as `curry` + `rice-wine` + `pizza` _and_ as `curry-rice` + `wine` + `pizza`, both three emoji, so ADR-0004's exactly-three rule does not disambiguate. A dot cannot occur inside a slug, so the parse is unambiguous by construction.

Every position accepts any of that emoji's terms — the `displayName`, the CLDR `spokenName`, the plural and the synonyms, 937 distinct slugs over 307 emoji — so one Handle has many aliases and exactly one **canonical** alias (the `displayName` slugs, `canonicalAliasOf`). `resolveAlias` is pure and answers with a **candidate set**, never a Handle: it says which Handles the words could mean, and the route composes that with the availability read to find out which of them anybody has. The count of _claimed_ matches then decides:

| Claimed Handles matching | The route answers                                                                                       |
| ------------------------ | ------------------------------------------------------------------------------------------------------- |
| exactly one              | that Profile, rendered in place — **not** a redirect, so the shared ASCII link stays in the address bar |
| more than one            | a listing of the matches, each with its emoji and the owner's display name                              |
| none                     | the claim call to action                                                                                |

**The listing is [#109](https://github.com/joshstothard/3moji/issues/109) and is not built**, so today "more than one" is a single honest line and nothing else — no emoji, no Handles, no controls. That line also covers the case the table above does not: an alias naming several Handles of which _none_ is claimed. The claim call to action is a page for one specific Handle, and `apple.apple.apple` with nothing claimed does not name one, so offering the builder there would mean guessing which of eight the visitor meant. A listing cannot cover it either — ADR-0008 omits unclaimed Handles from a listing — so the same line answers both, and #109 is where a real answer belongs. The claim call to action is therefore rendered only where the alias names exactly one Handle, which is the 96.8% case.

An alias page declares `rel="canonical"` pointing at the emoji path: an alias is ambiguous by construction and so can never be canonical. It is emitted only when exactly one Handle is being shown — where the page shows none, there is no single emoji path to point at, and inventing one would assert a meaning the alias does not have.

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
