# 3moji MVP

**Status:** Proposed
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
| 1     | The app is live at `3moji.me` and a person can create an account and sign in | —          | Not planned |
| 2     | A URL containing emoji resolves to exactly one canonical Handle              | —          | Not planned |
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

- [ ] `apps/api` no longer exists and `scripts/verify.sh` passes without it.
- [ ] A lint rule fails the build if `packages/core` imports a framework package.
- [ ] `3moji.me` serves the application over HTTPS.
- [ ] A person can sign up, receive a verification email, verify, and sign in.
- [ ] Migrations run from committed files in the build step; no schema change is applied by hand.

**Dependencies:** ADR-0003 accepted. Issue #19, which only the repository owner can do.

**Issues:**

- _Not planned yet._

### Phase 2 — The Emoji Set and canonicalisation

**Outcome:** A URL containing emoji resolves to exactly one canonical Handle, and a Reserved Handle cannot be claimed.

**Deliverables:**

- The Emoji Set shipped as versioned data in `packages/core`, pinned to Emoji 12.0.
- The curated name layer: `displayName`, `synonyms`, and a stored plural.
- The side-by-side render check and the verdict on the alphanumeric and geometric subgroups (issue #23).
- The Reserved Handle file and its domain-layer guard.
- The canonicalisation function and the unique index migration.

**Acceptance criteria:**

- [ ] A test asserts the Emoji Set's size and that every Spoken Name is unique.
- [ ] Canonicalisation decodes once, applies NFC, strips U+FE0E and U+FE0F, and validates every code point against the Emoji Set.
- [ ] A property test shows two spellings of one Handle produce the same canonical key.
- [ ] A Reserved Handle is rejected in the domain layer, and the database constraint holds under a concurrent insert.

**Dependencies:** Phase 1. ADR-0005 accepted. Issue #23, which needs two physical phones.

**Issues:**

- _Not planned yet._

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
| Better Auth hits an undocumented problem on this Next.js version | L          | H      | A hand-rolled Lucia-style sessions module is named as the fallback in ADR-0003                 |
| Squatting on launch day exhausts the memorable Handles           | M          | M      | The 24-hour hold, verification before a Claim is final, and rate limits on claims              |
| Vercel Hobby forbids commercial use                              | L          | H      | No monetisation is in scope; any premium tier requires moving to Pro first                     |
| Free-tier limits change under us                                 | M          | M      | The hosting report cites each figure with its date; re-check before launch                     |

## Open questions

- Do the `Symbols/alphanum` and `Symbols/geometric` subgroups stay in the Emoji Set? Excluding both takes it from 1,053 to 994. Decided in issue #23.
- Which flagged emoji are excluded after the side-by-side render check? Issue #23.
- Is three resends an hour the right limit? It is a starting value to tune, not a principle.

## Decision log

- 2026-09-11 — Next.js on Vercel is the whole application; `apps/api` is deleted and domain logic lives in a framework-free package. ADR-0003 to be written from [#17](https://github.com/joshstothard/3moji/issues/17).
- 2026-09-11 — A Handle is exactly three emoji at launch, held for 24 hours pending verification, and every live Account owns exactly one Handle, so Release deletes the Account. ADR-0004 to be written from [#14](https://github.com/joshstothard/3moji/issues/14).
- 2026-09-11 — The Emoji Set is pinned to Emoji 12.0: 1,053 single-codepoint emoji. ADR-0005 to be written from [#9](https://github.com/joshstothard/3moji/issues/9).
- 2026-09-12 — Spoken Names get a curated layer over the immutable CLDR names, holding names only. [#25](https://github.com/joshstothard/3moji/issues/25)
- 2026-09-12 — An unclaimed Handle renders the home-page builder pre-filled, rather than a 404. [#16](https://github.com/joshstothard/3moji/issues/16)

## Changelog

- 2026-09-12 — Created (Proposed).
