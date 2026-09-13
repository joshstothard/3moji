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
| 3     | You can claim a Handle end to end on the live site                           | #76        | Done        |
| 4     | A claimed Handle shows a real page its owner controls                        | #101       | Done        |
| 5     | It survives real people                                                      | #149       | Planned     |
| 6     | A Profile can be shared as a link that survives bios and chat apps           | #159       | Planned     |

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

**Outcome:** A visitor can pick three emoji and claim the Handle end to end on the live site, and can give it up again.

**Deliverables:**

- The home-page builder: the hero, spoken tagline, live URL preview, three slots, then category tabs and search over the curated term index.
- The three availability states, with theme-based swap suggestions when a pick is taken.
- Sign-up, hold, verification, and claim, as one atomic act for Account and Hold.
- **Release: account deletion, the `released_handle` tombstone, and its migration** ([ADR-0009](../adr/0009-release-leaves-a-tombstone-and-the-cooldown-is-dropped-for-the-mvp.md)).
- **The re-check inside the claim transaction** — ADR-0004 decision 7's third layer, deferred from #52 because there was no claim path to put it in.
- **Honest states for a Handle that resolves but cannot be claimed** ([#68](https://github.com/joshstothard/3moji/issues/68)).
- Every failure path recorded on issue #15, including resend with its rate limit.

**Acceptance criteria:**

- [x] Picking three emoji shows live availability, including the taken and held states.
- [x] Claiming holds the Handle for 24 hours, sends the email, and finalises on verification.
- [x] Each failure path on issue #15 has a test.
- [x] An expired hold frees the Handle and deletes the unverified Account, evaluated lazily with no scheduled job.
- [x] Releasing deletes the Account and writes a tombstone carrying **no user reference** — the row is the canonical key and a timestamp, nothing more ([ADR-0009](../adr/0009-release-leaves-a-tombstone-and-the-cooldown-is-dropped-for-the-mvp.md) decision 3).
- [x] A Handle released moments ago **can** be claimed immediately, asserted against a real Postgres. This is [#63](https://github.com/joshstothard/3moji/issues/63)'s outstanding criterion: "no cooldown" is satisfied by accident unless a test makes it deliberate.
- [x] The claim transaction re-checks reservations inside its own transaction, proven by a test that reserves a Handle mid-flight.
- [x] A reserved or blocked Handle never renders "This Handle is available". Done by #80: `/🍕🍕🍕` and `/🔪🔪🔪` resolve 200 and read "This Handle is reserved.", with no reason given.

**Dependencies:** Phases 1 and 2. ADR-0004 **as amended by** [ADR-0009](../adr/0009-release-leaves-a-tombstone-and-the-cooldown-is-dropped-for-the-mvp.md), which resolved the cooldown contradiction that blocked this phase; [ADR-0008](../adr/0008-handles-are-addressable-by-emoji-and-by-their-word-alias.md) accepted.

**Note on size.** This phase carries roughly eight issues, at the top of the 3-8 guidance, and splitting Claim from Release would be the natural cut. It is deliberately **not** split: [ADR-0008](../adr/0008-handles-are-addressable-by-emoji-and-by-their-word-alias.md) is accepted and therefore immutable, and it places the alias listing "Phase 4 or 5, not Phase 3", while `docs/architecture/data-model.md` pins the builder to Phase 3 and the visitor states to Phase 4. Inserting a phase would renumber those and make an immutable document false. The phase numbers are fixed; the epic can be planned in two passes if it proves unwieldy.

**Issues:**

- #77 Add the Handle repository port and its availability read — done
- #78 Build the home-page Handle builder with live URL preview — done
- #79 Add category tabs and search to the builder — done
- #80 Render the availability states and swap suggestions — done (also closed #68)
- #81 Claim: sign-up and hold as one atomic act — done
- #82 Finalise the Claim on verification, with the hold screen and resend — done
- #83 Expire holds lazily and delete the unverified Account — done
- #84 Release: account deletion and the released_handle tombstone — done (also meets #63's outstanding criterion: a just-released Handle is claimed at the instant of release, against real Postgres)

### Phase 4 — Profile

**Outcome:** A claimed Handle shows a real page, and its owner can edit it in place.

**Deliverables:**

- The Profile page and its three visitor states.
- Inline editing with drag-to-reorder Links.
- The unclaimed Handle rendering the builder pre-filled from the path.
- Field limits enforced in the domain, not only in the form.
- **The word alias resolver and the listing page** ([ADR-0008](../adr/0008-handles-are-addressable-by-emoji-and-by-their-word-alias.md)): the ASCII address a Handle can actually be shared at, and the page shown when one alias matches more than one claimed Handle.

**Acceptance criteria:**

- [x] A visitor at a claimed Handle sees the display name, bio, and ordered Links. Done by [#104](https://github.com/joshstothard/3moji/issues/104) (the Profile page) and [#107](https://github.com/joshstothard/3moji/issues/107) (the order is the owner's, set by keyboard or drag).
- [x] An unclaimed Handle renders the builder pre-filled with those three emoji and a claim call to action. Done by [#105](https://github.com/joshstothard/3moji/issues/105): the same `HandleBuilder`, given `initialEmoji` from the path. Reserved and `unknown` deliberately do **not** render it.
- [x] A held Handle reveals nothing about who holds it, and shows no expiry timestamp. Met by #80 and pinned by two regression assertions in `apps/web/src/app/[handle]/page.test.tsx` — one on the emoji path and one on the alias path.
- [x] Limits are enforced in `packages/core`: 30, 160, 10, and 40 characters, with `http` and `https` URLs only. Done by [#103](https://github.com/joshstothard/3moji/issues/103); at most ten Links is also a database `CHECK`.
- [x] A mutation revalidates the cache before redirecting, so the change is visible immediately. Done by [#106](https://github.com/joshstothard/3moji/issues/106): `revalidatePath` precedes `redirect` in `apps/web/src/components/profile-edit-action.ts`, and `profile-edit-action.test.ts` pins that order by recording the calls.
- [ ] A dot-separated word alias resolves: one claimed match renders that Profile **in place** rather than redirecting, several render the listing, none renders the claim call to action. **Two of three met** — one claimed match in place ([#108](https://github.com/joshstothard/3moji/issues/108)), several as a listing ([#109](https://github.com/joshstothard/3moji/issues/109)). The third is met only when the alias names a single Handle: with several candidates and none claimed there is no one Handle to offer a claim for, and ADR-0008 omits unclaimed Handles from listings. Left unticked and carried by [#121](https://github.com/joshstothard/3moji/issues/121), which needs a new ADR.
- [ ] Dotted path segments survive the deployed environment, not only `next dev` — ADR-0008's evidence for this was measured locally only, and Vercel's CDN may treat a dotted segment as a static-file request. **Not verifiable yet**: there is no deployment. Carried by [#32](https://github.com/joshstothard/3moji/issues/32), blocked on [#19](https://github.com/joshstothard/3moji/issues/19).

**Dependencies:** Phase 3. [ADR-0008](../adr/0008-handles-are-addressable-by-emoji-and-by-their-word-alias.md) accepted.

**Status:** Done — epic [#101](https://github.com/joshstothard/3moji/issues/101) and all eight issues closed. **Two acceptance criteria are carried forward rather than met**, and are left unticked above on purpose: the several-candidates, none-claimed alias case ([#121](https://github.com/joshstothard/3moji/issues/121), needs an ADR) and dotted segments on the deployed site ([#32](https://github.com/joshstothard/3moji/issues/32), needs a deployment).

**The storage layer is built** — [#102](https://github.com/joshstothard/3moji/issues/102): the `profile` and `link` tables, their migration, and the read port that resolves a canonical `HandleKey` to a Profile. A Profile is keyed on the Account, so Release takes it and its Links with it; Links carry an explicit order, and "at most ten" is enforced by the schema rather than by the write path. "Claimed but unedited" is a named state rather than an empty object. See [`data-model.md` § Profile](../architecture/data-model.md#profile). The field limits themselves are [#103](https://github.com/joshstothard/3moji/issues/103)'s and the write path is [#106](https://github.com/joshstothard/3moji/issues/106)'s.

**Issues:**

- #102 Add the profile and link tables with their migration and read path — done
- #103 Enforce the Profile field limits in the domain — done
- #104 Render the Profile at a claimed Handle — done
- #105 Render the builder pre-filled at an unclaimed Handle — done
- #106 Edit the Profile in place — done
- #107 Reorder Links by dragging, and by keyboard — done
- #108 Resolve a dot-separated word alias to a Handle — done
- #109 Render the listing when an alias matches several Handles — done

### Phase 5 — Launch readiness

**Outcome:** `3moji.me` is live and holds up to real traffic and real misuse.

**Deliverables:**

- A WCAG AA pass over the picker and the Profile.
- Structured JSON logging with a correlation id across every API boundary, and error tracking.
- Rate limits and abuse protection on claims and on every email-sending endpoint.

**Acceptance criteria:**

- [ ] An automated accessibility check passes on the picker and the Profile.
- [ ] The picker is fully operable by keyboard, with a regression test for the focus loss the prototype exposed.
- [ ] Every API boundary emits structured JSON logs carrying a correlation id.
- [ ] Claim and email endpoints are rate limited, with tests proving the limits.

**Dependencies:** Phases 1 to 4.

**Planned as epic [#149](https://github.com/joshstothard/3moji/issues/149).** Sharing on the word alias and the per-Profile Open Graph image moved to Phase 6 at planning, keeping this phase to the launch-critical safety and accessibility work. Error tracking stays a deliverable here but is **not planned as an issue**: the vendor and its account are the repo owner's decision, and [#148](https://github.com/joshstothard/3moji/issues/148)'s tracing proposal should land first. [#150](https://github.com/joshstothard/3moji/issues/150) comes first because planning found that `POST /api/auth/sign-up/email` is forwarded to Better Auth unrestricted, which very likely creates an Account with no Handle — against ADR-0004 — and is an unlimited email-sending endpoint; it measures before it fixes.

**Issues:**

- #150 Block Account sign-up that bypasses the claim
- #151 Give the E2E job migrations, app env and a test email sender
- #152 Check the picker and Profile components with axe
- #153 Check the rendered picker and Profile pages with axe in E2E
- #154 Prove the picker works by keyboard alone, end to end
- #155 Give every request a correlation id
- #156 Log one structured JSON line at every API boundary
- #157 Rate limit the claim action per IP and per email
- #158 Rate limit Better Auth's sign-in and email endpoints

### Phase 6 — Sharing

**Outcome:** A Profile can be shared as a link that survives bios and chat apps, and it previews with its own image.

**Deliverables:**

- Share affordances built on the **word alias**, plus an Open Graph image per Profile. ([ADR-0008](../adr/0008-handles-are-addressable-by-emoji-and-by-their-word-alias.md) rejected offering the percent-encoded URL as the shareable form: it is 45 characters of `%F0%9F…` and destroys the thing the product is for.)

**Acceptance criteria:**

- [ ] A claimed Profile offers its canonical word alias link to copy, and never the percent-encoded emoji URL.
- [ ] A shared Profile link unfurls with Open Graph metadata and an image of that Profile, and its canonical URL is the emoji path.

**Dependencies:** Phase 4. The E2E environment from Phase 5 ([#151](https://github.com/joshstothard/3moji/issues/151)) for the image test, and [#32](https://github.com/joshstothard/3moji/issues/32), because dotted alias paths are still unverified on Vercel's CDN.

**Planned as epic [#159](https://github.com/joshstothard/3moji/issues/159)**, split out of Phase 5 at planning.

**Issues:**

- #160 Add a control that copies the canonical word alias link
- #161 Add Open Graph metadata and an image for each Profile

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
- Is three resends an hour the right limit? It is a starting value to tune, not a principle. As built (#82) it is one constant, `RESEND_LIMITS` in `packages/core/src/auth/resend-allowance.ts`, with an overridable parameter on the pure decision — so tuning it is a one-line change, and the sign-up link counts towards the three.
- Should 🍑 and 🍆 stay claimable? Both were left in ([#18](https://github.com/joshstothard/3moji/issues/18)) on the grounds that context makes them rude. ADR-0007 makes Food & Drink a launch category, so they are now prominent rather than buried among a thousand.
- Which order do later category drops go in, and what triggers one? ADR-0007 defers Objects and schedules nothing else.
- Should the **canonical** word alias prefer a shorter unambiguous synonym where one exists? [ADR-0008](../adr/0008-handles-are-addressable-by-emoji-and-by-their-word-alias.md) decision 3 joins the `displayName` slugs, so 🍎🍎🍎 is `red-apple.red-apple.red-apple`. The shorter `apple.apple.apple` is accepted on input but names eight Handles.
- Are 🎉🎉🎉, 🎫🎫🎫 and 🍕🍕🍕 the right platform-owned Reserved Handles? They were chosen while implementing [#52](https://github.com/joshstothard/3moji/issues/52) and have never been confirmed as a product decision. 🧊🧊🧊 is deliberately not among them, because ADR-0004 decision 2 names it freely claimable.

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
- 2026-09-12 — The 30-day Handle cooldown is dropped for the MVP: a released Handle returns to the pool immediately. Release still writes a key-and-timestamp tombstone, because time cannot be backfilled. Resolves [#63](https://github.com/joshstothard/3moji/issues/63) and unblocks Phase 3; partially supersedes ADR-0004 decision 5 ([ADR-0009](../adr/0009-release-leaves-a-tombstone-and-the-cooldown-is-dropped-for-the-mvp.md))

- 2026-09-12 — One Postgres driver in every environment: `node-postgres`, replacing the serverless HTTP driver in production. The driver was chosen by `NODE_ENV`, so CI exercised something production never ran and four merged PRs passed over a Claim path that could not open a transaction. Partially supersedes ADR-0006 decision 6's driver clause; unblocks #84 ([ADR-0010](../adr/0010-use-one-postgres-driver-in-every-environment.md))
- 2026-09-13 — Phase 5 is split: sharing on the word alias and the per-Profile Open Graph image become **Phase 6 — Sharing**, so Phase 5 holds only the launch-critical safety and accessibility work. Decided by the repo owner when Phase 5 was planned.

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
- 2026-09-12 — Synced from GitHub: Phase 1 In progress (epic #26, 5 of 6 closed; #32 blocked on #19);
  Phase 2 In progress (epic #48, 6 of 7 closed; #55 blocked on #23). Both already matched the
  document, so no status changed. **Phase 3 rescoped** for the two ADRs accepted today: it now
  carries Release with its tombstone and migration ([ADR-0009](../adr/0009-release-leaves-a-tombstone-and-the-cooldown-is-dropped-for-the-mvp.md)),
  the claim-transaction re-check deferred from #52, and #68. Phase 4 gains the word alias resolver
  and the listing page, and Phase 5's share affordance is rebuilt on the alias rather than the
  percent-encoded URL ([ADR-0008](../adr/0008-handles-are-addressable-by-emoji-and-by-their-word-alias.md)).
  Two open questions added. **Phase 3 is deliberately not split** even though it sits at the top of
  the 3-8 guidance: ADR-0008 is immutable and places the listing in "Phase 4 or 5", so renumbering
  would make an accepted decision false.
- 2026-09-12 — Phase 3 planned: epic #76, issues #77–#84. #68 is folded into #80 (a reserved or
  blocked Handle is an availability state, not a separate surface) and ADR-0004 decision 7's
  in-transaction re-check into #81 (alone it would be a wrapper with nothing calling it). Noted on
  the epic: the phase outcome says "on the live site", which cannot be demonstrated until #19
  unblocks #32 — every issue is testable locally and in CI regardless.
- 2026-09-12 — The Claim is finalised on verification, with the hold screen and resend (#82). Three things
  worth carrying forward. **Better Auth's verification token is a stateless JWT it never stores**, so
  "each resend invalidates the previous link" cannot be configured — it needs our own record, which is
  the new `verification_dispatch` table, and an interception point, which is why the emailed link points
  at `/claim/verify` rather than at Better Auth's own endpoint. **Verifying also has to write
  `handle.claimed_at`**, in the same transaction as `email_verified`: without it a verified owner's
  Handle still reads as held and lazy expiry (#83) would free it. And **the non-enumeration promise is
  now kept in the domain**: `submitClaim` collapses `already-registered` into `pending` so no transport
  can leak it, pads the fast branch to Better Auth's own 500 ms floor, and the claim adapter hashes the
  password even after deciding the address is taken. One deviation flagged: verifying lands on
  `/claim/verified/<handle>` rather than on the Handle itself, because `/[handle]` is a Phase 4
  placeholder that reads no database and would tell a new owner their Handle is available.
- 2026-09-12 — Synced from GitHub: **Phase 3 Done** (epic #76 closed, all eight issues #77–#84
  closed). Phase 1 In progress (epic #26, 5 of 6; #32 blocked on #19) and Phase 2 In progress
  (epic #48, 6 of 7; #55 blocked on #23) are unchanged — both wait on work only the repository
  owner can do. All eight Phase 3 acceptance criteria are ticked, including "each failure path on
  #15 has a test": the two password-reset paths have no page yet, but they are covered at the API
  level in `packages/core/src/auth/auth.integration.test.ts`, including #15's judgement call that a
  successful reset must not mark an email verified. Phase 3 also closed three issues outside its own
  list: #68 (a reserved Handle rendering "available"), #63 (the cooldown contradiction) and #89
  (the production driver could not open a transaction).
- 2026-09-12 — Phase 4 planned: epic #101, issues #102–#109. The held-state criterion is already
  met by #80 and is pinned by a regression assertion in #104 rather than rebuilt. The dotted-segment
  criterion cannot close until the site deploys (#32, blocked on #19), and #108 records that rather
  than claiming it. One schema decision was made rather than left open: a Profile is keyed on the
  **Account**, not the Handle, so it cascades on Release through the path that already exists.
- 2026-09-13 — Synced from GitHub: **Phase 4 In progress** (epic #101, 5 of 8 issues done —
  #102–#106 merged as PRs #113, #112, #116, #114, #118). #107 is unblocked now #106 has merged;
  #108 is open on PR #117, which conflicted with the Profile work rather than textually; #109
  stays blocked behind #108. #106 was left open by the auto-merge squash bug (#42) and closed by
  hand. New: #119 — a fresh worktree has no git hooks until `npm install`, and git does not say
  so, which on a public repo means secretlint can be silently absent.
- 2026-09-13 — Synced from GitHub: **Phase 4 Done** (epic #101 closed; #107, #108, #109 merged as
  PRs #123, #117, #128). Five of seven acceptance criteria ticked, each against its evidence rather
  than its issue's state; two carried forward unticked — the several-candidates, none-claimed alias
  case (#121, needs an ADR) and dotted segments on the deployed site (#32, needs #19). Along the
  way: formatting had no server-side gate and `main` went red (#122); a worktree can have no git
  hooks silently (#119, with the provisioning decision split to #126); and the auto-merge gate read
  a run GitHub refused to start as a failure (#125, fixed by #127 and proven live on #128). #58 —
  the gate is not re-triggered after it updates a branch — is still open and reproduced on #128.
- 2026-09-13 — Phase 5 planned: epic #149, issues #150–#158. Sharing and the Open Graph image moved to a new Phase 6 — Sharing, planned as epic #159 with issues #160–#161. Error tracking is not planned as an issue pending the vendor decision and #148. Planning found an unrestricted `POST /api/auth/sign-up/email`, filed as #150.
