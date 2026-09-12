# 3moji MVP

**Status:** Active
**Owner:** Josh Stothard
**Started:** 2026-09-12
**Target:** None
**Related:** [Emoji Set candidate](../reports/2026-09-11-emoji-set.md), [Auth library](../reports/2026-09-11-auth-library.md), [Hosting and email](../reports/2026-09-11-hosting-and-email.md), [Emoji URLs](../reports/2026-09-11-emoji-urls.md), and the [3moji MVP map](https://github.com/joshstothard/3moji/issues/8)

## Goal

A person can claim a three-emoji Handle at `3moji.me`, point it at a public page of links, and hand that Handle to someone by saying it out loud.

## Why now

The [3moji MVP map](https://github.com/joshstothard/3moji/issues/8) closed every open decision: twelve decision tickets resolved, four research reports on `main`, and a prototype built and judged. Nothing is left to decide before building. The vocabulary is fixed in [`CONTEXT.md`](../../CONTEXT.md).

## Scope

- Sign-up with email and password, with verification and password reset.
- The curated Emoji Set with its Spoken Names, display names, synonyms, and plurals.
- Claiming a three-emoji Handle, held for 24 hours pending email verification.
- The public Profile: display name, bio, and ordered Links.
- The home-page builder, which doubles as the page an unclaimed Handle renders.
- Deployment on Vercel, with Neon Postgres and Resend.

## Non-goals

- Payments, premium tiers, and Handle trading or selling. Any of these needs Vercel Pro first.
- Claiming one- and two-emoji Handles. Reserved at launch.
- Custom domains, analytics, social login, native apps, and teams.
- QR code generation.
- Moderation of Link and Profile content beyond the URL scheme check.
- Keeping a NestJS API.

## Success criteria

- [ ] A Handle can be claimed, verified, and resolved end to end on the live site.
- [ ] Two spellings of the same Handle reach one Profile, and a non-canonical spelling redirects rather than returning 404.
- [ ] Unit test coverage stays above 70%.
- [ ] The picker passes an automated accessibility check at WCAG AA.
- [ ] ADR-0004 records all four MVP simplifications as deliberate and revisitable.

## Approach

`apps/web` is the only deployed application. Route handlers and server actions are thin transport adapters over a framework-free `packages/core`, wired by a manual composition root rather than a DI container. That boundary is what keeps a future NestJS API cheap, so it is enforced from the first phase rather than retrofitted.

A Handle's canonical key is its code-point sequence after decoding, NFC normalisation, and stripping variation selectors. Uniqueness is a database constraint on that key, which only means anything if the application canonicalises before every write, so canonicalisation lands before any claim logic.

## Phases

| Phase | Outcome                                                                      | Epic issue | Status      |
| ----- | ---------------------------------------------------------------------------- | ---------- | ----------- |
| 1     | The app is live at `3moji.me` and a person can create an account and sign in | #26        | In progress |
| 2     | A URL containing emoji resolves to exactly one canonical Handle              | #48        | In progress |
| 3     | You can claim a Handle end to end on the live site                           | —          | Not planned |
| 4     | A claimed Handle shows a real page its owner controls                        | —          | Not planned |
| 5     | It survives real people                                                      | —          | Not planned |

### Phase 1 — Foundation and providers

**Outcome:** The app is live at `3moji.me` and a person can create an account, verify it by email, and sign in.

**Deliverables:**

- `apps/api` deleted, with its workspace and Turborepo entries removed.
- `packages/core` created: no `next/*`, no React, no Vercel primitives.
- Vercel project, Neon Postgres, Resend, and DNS provisioned (issue #19).
- Drizzle wired with the first migration, covering the auth tables.
- Better Auth configured with `requireEmailVerification`, `autoSignInAfterVerification`, and `revokeSessionsOnPasswordReset`.
- A manual composition root wiring dependencies by constructor injection.

**Acceptance criteria:**

- [x] `apps/api` no longer exists and `scripts/verify.sh` passes without it.
- [x] A lint rule fails the build if `packages/core` imports a framework package.
- [ ] `3moji.me` serves the application over HTTPS.
- [x] A person can sign up, receive a verification email, verify, and sign in. Proved by integration tests against a real Postgres; not yet on a deployed site.
- [ ] Migrations run from committed files in the build step; no schema change is applied by hand.

**Dependencies:** ADR-0006 accepted. Issue #19, which only the repository owner can do.

**Issues:**

- #27 Remove the OKR demo pages and API client from the web app — done
- #28 Delete apps/api and its CI jobs, image build, and doc references — done
- #29 Create packages/core with an enforced framework-free boundary — done
- #30 Add Drizzle and the first migration for the auth tables — done
- #31 Wire Better Auth with verification required and auto sign-in — done
- #32 Deploy to Vercel with migrations running in the build step — blocked on #19 (accounts, payment method and DNS: only the repository owner can do it)

### Phase 2 — The Emoji Set and canonicalisation

**Outcome:** A URL containing emoji resolves to exactly one canonical Handle, and a Reserved Handle cannot be claimed.

**Deliverables:**

- The Emoji Set shipped as versioned data in `packages/core`, pinned to Emoji 12.0, with the **three launch categories** released ([ADR-0007](../adr/0007-release-the-emoji-set-in-category-drops.md)).
- The curated name layer: `displayName`, `synonyms`, and a stored plural.
- The side-by-side render check and the verdict on the alphanumeric and geometric subgroups (issue #23).
- The Reserved Handle file and its domain-layer guard.
- The canonicalisation function and the unique index migration.

**Acceptance criteria:**

- [x] A test asserts the released set is the three launch categories (307 emoji) and that every Spoken Name in it is unique.
- [x] An emoji outside a released category cannot form a Handle, asserted in the domain layer.
- [x] Canonicalisation decodes once, applies NFC, strips U+FE0E and U+FE0F, and validates every code point against the Emoji Set.
- [x] A property test shows two spellings of one Handle produce the same canonical key.
- [x] A Reserved Handle is rejected in the domain layer, and the database constraint holds under a concurrent insert.

**Dependencies:** Phase 1. ADR-0005 and ADR-0007 accepted. Issue #23 narrowed to the three launch categories, which still needs two physical phones.

**Issues:**

- #49 Ship the released Emoji Set into packages/core — done
- #50 Add Handle canonicalisation with property-based tests — done
- #51 Add the handle table, its canonical-key unique index and migration — done
- #52 Add the Reserved Handle list and its three-layer domain guard — done (two layers built; the in-transaction re-check is deferred to Phase 3, which is where the claim path is written)
- #53 Resolve an emoji URL to a canonical Handle — done
- #54 Curate display names, synonyms and plurals for the launch set — done
- #55 Apply the render-check verdict to the launch categories — blocked by #23 (needs two physical phones)

### Phase 3 — Claim

**Outcome:** A visitor can pick three emoji and claim the Handle end to end on the live site.

**Deliverables:**

- The home-page builder: the hero, spoken tagline, live URL preview, three slots, then category tabs and search.
- The three availability states, with theme-based swap suggestions when a pick is taken.
- Sign-up, hold, verification, and claim, as one atomic act for Account and Hold.
- Every failure path recorded on issue #15, including resend with its rate limit.

**Acceptance criteria:**

- [ ] Picking three emoji shows live availability, including the taken and held states.
- [ ] Claiming holds the Handle for 24 hours, sends the email, and finalises on verification.
- [ ] Each failure path on issue #15 has a test.
- [ ] An expired hold frees the Handle and deletes the unverified Account, evaluated lazily with no scheduled job.

**Dependencies:** Phases 1 and 2. ADR-0004 accepted.

**Issues:**

- _Not planned yet._

### Phase 4 — Profile

**Outcome:** A claimed Handle shows a real page, and its owner can edit it in place.

**Deliverables:**

- The Profile page and its three visitor states.
- Inline editing with drag-to-reorder Links.
- The unclaimed Handle rendering the builder pre-filled from the path.
- Field limits enforced in the domain, not only in the form.

**Acceptance criteria:**

- [ ] A visitor at a claimed Handle sees the display name, bio, and ordered Links.
- [ ] An unclaimed Handle renders the builder pre-filled with those three emoji and a claim call to action.
- [ ] A held Handle reveals nothing about who holds it, and shows no expiry timestamp.
- [ ] Limits are enforced in `packages/core`: 30, 160, 10, and 40 characters, with `http` and `https` URLs only.
- [ ] A mutation revalidates the cache before redirecting, so the change is visible immediately.

**Dependencies:** Phase 3.

**Issues:**

- _Not planned yet._

### Phase 5 — Launch readiness

**Outcome:** `3moji.me` is live and holds up to real traffic and real misuse.

**Deliverables:**

- A WCAG AA pass over the picker and the Profile.
- Share affordances that also offer the percent-encoded URL, plus an Open Graph image per Profile.
- Structured JSON logging with a correlation id across every API boundary, and error tracking.
- Rate limits and abuse protection on claims and on every email-sending endpoint.

**Acceptance criteria:**

- [ ] An automated accessibility check passes on the picker and the Profile.
- [ ] The picker is fully operable by keyboard, with a regression test for the focus loss the prototype exposed.
- [ ] Every API boundary emits structured JSON logs carrying a correlation id.
- [ ] Claim and email endpoints are rate limited, with tests proving the limits.

**Dependencies:** Phases 1 to 4.

**Issues:**

- _Not planned yet._

## Risks & mitigations

| Risk                                                             | Likelihood | Impact | Mitigation                                                                                     |
| ---------------------------------------------------------------- | ---------- | ------ | ---------------------------------------------------------------------------------------------- |
| The Neon Free plan is not selectable in the Vercel Marketplace   | M          | M      | Verify during issue #19; fall back to Supabase used as Postgres only                           |
| Emoji diverge across platforms more than the evidence suggests   | M          | L      | The evidence is a 2016 study, so issue #23 does a side-by-side render before the set is frozen |
| Better Auth hits an undocumented problem on this Next.js version | L          | H      | A hand-rolled Lucia-style sessions module is named as the fallback in ADR-0006                 |
| Squatting on launch day exhausts the memorable Handles           | M          | M      | The 24-hour hold, verification before a Claim is final, and rate limits on claims              |
| Vercel Hobby forbids commercial use                              | L          | H      | No monetisation is in scope; any premium tier requires moving to Pro first                     |
| Free-tier limits change under us                                 | M          | M      | The hosting report cites each figure with its date; re-check before launch                     |

## Open questions

- Do the `Symbols/alphanum` and `Symbols/geometric` subgroups stay in the Emoji Set? Excluding both takes it from 1,053 to 994. Decided in issue #23.
- Which flagged emoji are excluded after the side-by-side render check? Issue #23.
- Is three resends an hour the right limit? It is a starting value to tune, not a principle.
- Should 🍑 and 🍆 stay claimable? Both were left in ([#18](https://github.com/joshstothard/3moji/issues/18)) on the grounds that context makes them rude. ADR-0007 makes Food & Drink a launch category, so they are now prominent rather than buried among a thousand.
- Which order do later category drops go in, and what triggers one? ADR-0007 defers Objects and schedules nothing else.

## Decision log

- 2026-09-11 — Next.js on Vercel is the whole application; `apps/api` is deleted and domain logic lives in a framework-free package. ADR-0006 to be written from [#17](https://github.com/joshstothard/3moji/issues/17).
- 2026-09-11 — A Handle is exactly three emoji at launch, held for 24 hours pending verification, and every live Account owns exactly one Handle, so Release deletes the Account. ADR-0004 to be written from [#14](https://github.com/joshstothard/3moji/issues/14).
- 2026-09-11 — The Emoji Set is pinned to Emoji 12.0: 1,053 single-codepoint emoji. ADR-0005 to be written from [#9](https://github.com/joshstothard/3moji/issues/9).
- 2026-09-12 — Spoken Names get a curated layer over the immutable CLDR names, holding names only. [#25](https://github.com/joshstothard/3moji/issues/25)
- 2026-09-12 — An unclaimed Handle renders the home-page builder pre-filled, rather than a 404. [#16](https://github.com/joshstothard/3moji/issues/16)
- 2026-09-12 — Next.js on Vercel is the whole application; `apps/api` is deleted and domain logic lives in `packages/core` ([ADR-0006](../adr/0006-nextjs-on-vercel-is-the-whole-application.md))
- 2026-09-12 — The Handle model: canonical key, 24-hour hold, one Handle per Account, Release as account deletion ([ADR-0004](../adr/0004-the-handle-model.md))
- 2026-09-12 — The Emoji Set pinned to Emoji 12.0 with a curated name layer and no colour field ([ADR-0005](../adr/0005-the-emoji-set.md))
- 2026-09-12 — A Handle keeps one identity and gains a second address: a dot-separated word alias, because an autolinker truncates the emoji URL and drops the Handle. Partially supersedes ADR-0004 decision 1's unconditional 404 ([ADR-0008](../adr/0008-handles-are-addressable-by-emoji-and-by-their-word-alias.md))

## Changelog

- 2026-09-12 — Created (Proposed).
- 2026-09-12 — ADR-0006 (then numbered 0003), ADR-0004 and ADR-0005 accepted; architecture docs added for the data model and auth.
- 2026-09-12 — Phase 1 planned: epic #26, issues #27–#32.
- 2026-09-12 — Clerical fix: the Next.js ADR is renumbered 0003 → 0006. ADR-0003 was taken on `main` by the auto-merge decision, which landed from a separate PR while this one was drafted. No decision changed.
- 2026-09-12 — Status Proposed → Active. Phase 1 is five-sixths done: #27, #28, #29, #30 and #31 are closed. #32 is the only remaining item and is blocked on #19, which needs accounts, a payment method and DNS access.
- 2026-09-12 — The Emoji Set is released in category drops; a Handle may only use emoji from a released category, starting with Food & Drink, Animals & Nature and Activities ([ADR-0007](../adr/0007-release-the-emoji-set-in-category-drops.md), partially superseding ADR-0005 decision 1)
- 2026-09-12 — Phase 2 planned: epic #48, issues #49–#55.
- 2026-09-12 — The released Emoji Set shipped as data in `packages/core` (#49), then the
  curated name layer over it (#54): 307 rows of `displayName`, `synonyms`, plural and
  article, with 29 display names overridden and the rest defaulting to the CLDR name. 🧊 now
  says "three ice cubes" and answers a search for "ice cube".
- 2026-09-12 — An emoji URL now resolves to exactly one canonical Handle (#53). The root-level
  `[handle]` route is a thin adapter over `canonicalise`: 404 when a segment is not a Handle,
  308 to the percent-encoded canonical path when it is spelled otherwise, and a deliberately
  minimal "this Handle is available" placeholder when it is canonical. Confirmed against the
  pinned Next.js version that `params` arrives percent-encoded **and upper-cased**, so a stray
  variation selector — not lower-case hex — is the spelling that needs the redirect.
- 2026-09-12 — Phase 2 synced from GitHub: **6 of 7 issues done** (#49–#54 closed, epic #48 In
  progress). Canonicalisation landed with property tests over the released set (#50), then the
  `handle` table with its canonical-key unique index under the deterministic `C` collation (#51),
  then the Reserved Handle list (#52). All five acceptance criteria are met — the concurrency one
  by an integration test that has two Accounts insert the same key at once and asserts exactly one
  row survives. **#55 is the only item left**, and it is blocked on #23, which needs two physical
  phones. Two caveats recorded rather than smoothed over: the Reserved Handle guard ships **two**
  enforcement layers, not three, because the in-transaction re-check has no claim path to sit in
  until Phase 3; and seven of the nine blocked emoji are unreachable today, since only 🔫 (Activities)
  and 🔪 (Food & Drink) fall in a released category.
