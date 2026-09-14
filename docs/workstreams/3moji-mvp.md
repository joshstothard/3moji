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
| 5     | It survives real people                                                      | #149       | Done        |
| 6     | A Profile can be shared as a link that survives bios and chat apps           | #159       | Done        |
| 7     | Owners can come back, and it is lawful to launch                             | #191       | Done        |
| 8     | A listener can find a Handle, and the site is polished and operable          | #199       | In progress |

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

- [x] An automated accessibility check passes on the picker and the Profile.
- [x] The picker is fully operable by keyboard, with a regression test for the focus loss the prototype exposed.
- [x] Every API boundary emits structured JSON logs carrying a correlation id.
- [x] Claim and email endpoints are rate limited, with tests proving the limits.

**Dependencies:** Phases 1 to 4.

**Planned as epic [#149](https://github.com/joshstothard/3moji/issues/149).** Sharing on the word alias and the per-Profile Open Graph image moved to Phase 6 at planning, keeping this phase to the launch-critical safety and accessibility work. Error tracking stays a deliverable here but is **not planned as an issue**: the vendor and its account are the repo owner's decision, and [#148](https://github.com/joshstothard/3moji/issues/148)'s tracing proposal should land first. [#150](https://github.com/joshstothard/3moji/issues/150) comes first because planning found that `POST /api/auth/sign-up/email` is forwarded to Better Auth unrestricted, which very likely creates an Account with no Handle — against ADR-0004 — and is an unlimited email-sending endpoint; it measures before it fixes. [#163](https://github.com/joshstothard/3moji/issues/163), found the same day while landing #148, ranks with it: the Claim matches email addresses case-sensitively while Better Auth lowercases them, which by the code path both reveals whether an address is registered and very likely stops anyone who types a capital letter from claiming at all.

**Issues:**

- #150 Block Account sign-up that bypasses the claim — done
- #151 Give the E2E job migrations, app env and a test email sender — done
- #152 Check the picker and Profile components with axe — done
- #153 Check the rendered picker and Profile pages with axe in E2E — done
- #154 Prove the picker works by keyboard alone, end to end — done
- #155 Give every request a correlation id — done
- #156 Log one structured JSON line at every API boundary — done
- #157 Rate limit the claim action per IP and per email — done
- #158 Rate limit Better Auth's sign-in and email endpoints — done
- #163 Claim treats email case differently from Better Auth, leaking existence and blocking sign-up — done
- #169 Fail the build when a Better Auth upgrade could reopen Account creation over HTTP — done
- #177 Bring the remaining light-grey text and affordances up to WCAG AA contrast — done
- #180 Rate limit the sign-in form, which Better Auth's limiter never sees — done
- #182 Measure whether form field borders meet WCAG 1.4.11 non-text contrast — done
- #185 Bring Handle builder button boundaries up to WCAG 1.4.11 contrast — done
- #187 Stop the alias-listing E2E test claiming Handles another spec needs unclaimed — done

### Phase 6 — Sharing

**Outcome:** A Profile can be shared as a link that survives bios and chat apps, and it previews with its own image.

**Deliverables:**

- Share affordances built on the **word alias**, plus an Open Graph image per Profile. ([ADR-0008](../adr/0008-handles-are-addressable-by-emoji-and-by-their-word-alias.md) rejected offering the percent-encoded URL as the shareable form: it is 45 characters of `%F0%9F…` and destroys the thing the product is for.)

**Acceptance criteria:**

- [x] A claimed Profile offers its canonical word alias link to copy, and never the percent-encoded emoji URL.
- [x] A shared Profile link unfurls with Open Graph metadata and an image of that Profile, and its canonical URL is the emoji path.

**Dependencies:** Phase 4. The E2E environment from Phase 5 ([#151](https://github.com/joshstothard/3moji/issues/151)) for the image test, and [#32](https://github.com/joshstothard/3moji/issues/32), because dotted alias paths are still unverified on Vercel's CDN.

**Planned as epic [#159](https://github.com/joshstothard/3moji/issues/159)**, split out of Phase 5 at planning.

**Issues:**

- #160 Add a control that copies the canonical word alias link — done
- #161 Add Open Graph metadata and an image for each Profile — done

### Phase 7 — Owners can come back, and it is lawful to launch

**Outcome:** A returning owner can sign in, find and edit their Profile, sign out, reset a forgotten password and delete their Account, and the site carries what a UK-run service publishing user content needs before it is announced.

**Deliverables:**

1. **Password reset pages.** There is no `/reset-password` route, and the header comment in `apps/web/src/app/sign-in/page.tsx` says reset "has no page of its own". The [MVP map](https://github.com/joshstothard/3moji/issues/8) put reset in scope. **This is a live bug, not only a gap:** the claim-collision email (`packages/core/src/auth/claim-collision.ts`, its URL built in `packages/core/src/composition-root.ts` as `${baseUrl}/reset-password`) already sends existing owners a link that 404s. Better Auth's `sendResetPassword` (`packages/core/src/auth/create-auth.ts`) emails its own URL, which must land on a working page too.
2. **An account area.** The navbar (`apps/web/src/components/navbar.tsx`) is only the logo, sign-in lands on `/` with no signed-in state, the Profile deliberately does not link to its `/edit` page, and there is no sign-out anywhere. `releaseHandle` exists in `packages/core/src/handle/release-handle.ts` with no UI.
3. **A privacy notice, terms, and abuse reporting.** None exist: `packages/shared/messages/en.json` has no keys for them, and the footer (`apps/web/src/components/footer.tsx`) shows only a UI version. The owner is UK-based, and the service stores email addresses and each session's IP address and user agent. Whether the Online Safety Act's user-to-user duties apply is to be checked against Ofcom's guidance: a Profile is user-generated content that other people encounter, and the Act's limited-functionality exemption (Schedule 1, paragraph 4) covers only comments and reviews on the provider's own content, so the service is **likely in scope (inference, to be confirmed with Ofcom's Regulation Checker)**. The non-goal "moderation beyond the URL scheme check" stands: reporting is not moderation.

**Acceptance criteria:**

_Password reset:_

- [x] Requesting a reset and setting a new password both work with JavaScript disabled.
- [x] The link in the claim-collision email resolves to the reset page rather than 404, and so does the URL Better Auth's `sendResetPassword` emails.
- [x] Requesting a reset gives the same response whether or not the address is registered, and the existing rate limits still apply to it.
- [x] A successful reset still revokes existing sessions (`revokeSessionsOnPasswordReset`), proven by a test.
- [x] The sign-in page links to "forgot your password".

_Account area:_

- [x] A signed-in owner sees a signed-in state, with links to their Profile and to its edit page.
- [x] Signing out ends the session: a request carrying the old session cookie is treated as signed out.
- [x] An owner can delete their Account (Release) behind plain, explicit copy that says the Handle is given up and the Account deleted ([ADR-0004](../adr/0004-the-handle-model.md) decision 5, [ADR-0009](../adr/0009-release-leaves-a-tombstone-and-the-cooldown-is-dropped-for-the-mvp.md)); afterwards the Handle is claimable.
- [x] The public Profile stays cacheable and identical for every visitor: owner affordances do not vary the public page's cached response, proven by a test.

_Privacy, terms and reporting:_

- [x] `/privacy` and `/terms` exist in plain English, drafted by the agent and clearly marked as needing owner or legal review before announcement. Met as worded by [#196](https://github.com/joshstothard/3moji/issues/196): both pages are **drafts pending owner review**. They show "Draft — pending owner review", and they are not final until the owner answers the questions in [owner actions](../owner-actions.md) and removes the marker.
- [x] Both are linked from the footer and from the claim form, where an email address is collected.
- [x] Every Profile offers a way to report it; a `mailto:` to a contact address read from an environment variable is enough.
- [x] A written takedown procedure exists in `docs/runbooks/`.
- [x] Whether the Online Safety Act's user-to-user duties apply is written down, citing Ofcom's guidance. It is in [`docs/runbooks/takedown.md`](../runbooks/takedown.md) § 6, as an assessment for the owner to confirm with Ofcom's Regulation Checker, not a conclusion.
- [x] The footer links privacy, terms and reporting, and carries the Twemoji CC-BY 4.0 attribution.

**Dependencies:** Phases 3 to 6. Verifying any item on the live site needs [#32](https://github.com/joshstothard/3moji/issues/32), which is blocked on [#19](https://github.com/joshstothard/3moji/issues/19).

**Planned as epic [#191](https://github.com/joshstothard/3moji/issues/191).** Finding a Handle, the rare three-of-a-kind celebration, site hygiene and the operations minimum moved to Phase 8 at planning, keeping this phase to the launch-blocking owner return path and legal work. The footer's Twemoji CC-BY attribution criterion moved here from site hygiene, because [#198](https://github.com/joshstothard/3moji/issues/198) does it.

**Status:** Done — epic [#191](https://github.com/joshstothard/3moji/issues/191) and all nine issues are closed, including #214 and #216, which were added after planning. Every acceptance criterion is ticked against its evidence, but **nothing is verified on a deployed site**: `3moji.me` is not live ([#32](https://github.com/joshstothard/3moji/issues/32), blocked on [#19](https://github.com/joshstothard/3moji/issues/19)). The privacy notice and terms are drafts pending owner review, and the report link shows nothing until `REPORT_CONTACT_EMAIL` is set.

**Issues:**

- #192 Add the password reset request and set-new-password pages — done
- #193 Show a signed-in state with links to the owner's Profile and edit page — done
- #194 Add sign-out — done
- #195 Let an owner delete their Account and give up their Handle — done
- #196 Draft the privacy notice and terms pages — done (drafts pending owner review)
- #197 Add a report link to every Profile and a takedown runbook — done
- #198 Link privacy, terms, reporting and the Twemoji credit from the footer — done
- #214 Stop storing client IP addresses in clear in Better Auth's rate-limit table — done
- #216 Send non-enumerating emails after the response so timing can't reveal an address — done

### Phase 8 — Findable, polished and operable

**Outcome:** A listener who heard a Handle can find it, the site looks and behaves like a finished product, and the operator can see and recover from failure.

**Deliverables:**

1. **Finding a Handle you heard.** Profiles already show the canonical word alias with a copy button ([#160](https://github.com/joshstothard/3moji/issues/160)), but a listener has no lookup, and the spoken form (`3moji.me/three-ice-cubes`) 404s.
2. **A rare three-of-a-kind celebration.** Three-of-a-kind Handles stay claimable rather than reserved (Decision log, 2026-09-13). When a visitor builds an all-same triple that is **available**, the builder plays a short animation marking it as rare.
3. **Site hygiene.** `apps/web/public/` holds only `.gitkeep`; there is no `not-found.tsx` or `error.tsx`; `apps/web/next.config.ts` sets only `output: "standalone"`; and the layout metadata in `apps/web/src/app/layout.tsx` has no `metadataBase` or `openGraph`. The glyphs in the Open Graph images come from Twemoji 16.0.1 via `apps/web/src/lib/og/`, which is CC-BY 4.0 and is not yet attributed on the site.
4. **An operations minimum.** Vercel Hobby keeps runtime logs for one hour and Neon Free restores only to within six hours ([hosting and email report](../reports/2026-09-11-hosting-and-email.md)), and `docs/runbooks/` does not exist although `AGENTS.md` requires runbooks. **Error tracking** uses Vercel's own logs (Decision log, 2026-09-13). Log drains and longer log retention are understood to be Vercel Pro features — **to be confirmed against Vercel's current docs, not verified here** — so error tracking waits on the owner's expected move to Pro.

**Acceptance criteria:**

_Finding a Handle:_

- [x] A "find a Handle" entry on the home page resolves typed words through `resolveAlias`.
- [x] The spoken form (`three ice cubes`) resolves through the Find a Handle lookup, which the 404 page also offers; the spoken path itself stays a 404.

_Rare three-of-a-kind:_

- [x] The animation plays only for an available three-of-a-kind Handle, never for a taken, held or reserved one, so it reveals no state the builder does not already show.
- [x] Under `prefers-reduced-motion` there is no motion, and a static rare indicator is shown instead.
- [x] It is announced once to assistive technology, without moving focus.
- [x] The existing axe and keyboard E2E checks still pass.

_Site hygiene:_

- [x] Branded 404 and error pages. Merged in PRs #228 and #232. The last criterion of [#203](https://github.com/joshstothard/3moji/issues/203), a structured log line for a server-side render error, is wired through `onRequestError` in `apps/web/src/instrumentation.ts`, which the owner allowed with tracing still forbidden pending [#148](https://github.com/joshstothard/3moji/issues/148) (Decision log, 2026-09-14).
- [x] A favicon.
- [x] `robots.txt`, and a sitemap of the static pages (not every Profile).
- [x] Home-page Open Graph metadata using the existing generic image.
- [x] Responses carry a Content Security Policy, HSTS, `frame-ancestors` or `X-Frame-Options`, `Referrer-Policy` and `X-Content-Type-Options`, verified by a test. HSTS, `X-Content-Type-Options`, `Referrer-Policy` and `X-Frame-Options` merged in PR #223. The Content Security Policy, a per-request nonce on every page (option 1 of the [#205 comment](https://github.com/joshstothard/3moji/issues/205#issuecomment-5656525123)), merged in PR #235. HSTS is sent without `preload` (Decision log, 2026-09-14).

_Operations:_

- [ ] A scheduled GitHub Actions job takes a nightly logical backup of the production database to a private, non-public destination, echoes no secret, and commits no dump to this public repository. The destination is an age-encrypted dump in a private Cloudflare R2 bucket (Decision log, 2026-09-14). **Not met:** the workflow is built (#206); the owner's setup, first green run and test restore are outstanding.
- [ ] An uptime check watches `/` and one Profile. **Not met:** waits on #32.
- [x] Runbooks exist in `docs/runbooks/` for "site down", "email not arriving" and "restore from backup".
- [x] Error tracking is recorded as waiting on the Vercel Pro upgrade.

**Dependencies:** Phase 7 ([#191](https://github.com/joshstothard/3moji/issues/191)). The backup and uptime work needs [#32](https://github.com/joshstothard/3moji/issues/32), which is blocked on [#19](https://github.com/joshstothard/3moji/issues/19).

**Planned as epic [#199](https://github.com/joshstothard/3moji/issues/199)**, split out of Phase 7 at planning.

**Issues:**

- #200 Add a "find a Handle" lookup to the home page — done
- #201 Resolve the spoken form of a Handle in the path — done: the `/find` spoken form merged in PR #217, and the 404 page offers the lookup (PR #234); the path form was not adopted (Decision log, 2026-09-14)
- #202 Celebrate an available three-of-a-kind Handle as rare — done
- #203 Add branded not-found and error pages — done: the pages merged in PR #228, and server-side render-error logging through `onRequestError` in PR #232
- #204 Add a favicon, robots.txt, sitemap and home-page preview metadata — done
- #205 Send security headers on every response — done: four headers merged in PR #223, and the nonce CSP (option 1) in PR #235
- #206 Back up the production database nightly — in progress: the workflow and the restore runbook are in review; closes after the owner's setup, first green run and a test restore ([owner actions](../owner-actions.md))
- #207 Add uptime checks and the operations runbooks — blocked on #32: the runbooks merged in PRs #224 and #227, and the uptime check waits on #32
- #233 Render the Handle route's 404 on the server so it works without JavaScript — deferred to Backlog: a Next.js 16.3.5 limitation (a thrown `notFound()` renders the `__next_error__` shell without JavaScript); the only fix is proxy routing, not worth it for the MVP; revisit if Next.js changes or post-launch traffic shows no-JS visitors hitting it ([deferral comment](https://github.com/joshstothard/3moji/issues/233#issuecomment-5660657064))

## Risks & mitigations

| Risk                                                                                                                          | Likelihood | Impact | Mitigation                                                                                                               |
| ----------------------------------------------------------------------------------------------------------------------------- | ---------- | ------ | ------------------------------------------------------------------------------------------------------------------------ |
| The Neon Free plan is not selectable in the Vercel Marketplace                                                                | M          | M      | Verify during issue #19; fall back to Supabase used as Postgres only                                                     |
| Emoji diverge across platforms more than the evidence suggests                                                                | M          | L      | The evidence is a 2016 study, so issue #23 does a side-by-side render before the set is frozen                           |
| Better Auth hits an undocumented problem on this Next.js version                                                              | L          | H      | A hand-rolled Lucia-style sessions module is named as the fallback in ADR-0006                                           |
| Squatting on launch day exhausts the memorable Handles                                                                        | M          | M      | The 24-hour hold, verification before a Claim is final, and rate limits on claims                                        |
| Vercel Hobby forbids commercial use                                                                                           | L          | H      | No monetisation is in scope; any premium tier requires moving to Pro first                                               |
| Free-tier limits change under us                                                                                              | M          | M      | The hosting report cites each figure with its date; re-check before launch                                               |
| Resend's free plan caps email at 100 a day, so on launch day later claimants get no verification email and their holds expire | M          | H      | Launch quietly on Free, log the daily send count, and move to Resend Pro before any public announcement (Open questions) |
| Phishing pages linked from Profiles on a fresh domain get `3moji.me` onto blocklists                                          | M          | H      | Reporting from every Profile and a takedown runbook (Phase 7); consider an outbound link check after launch              |

## Open questions

Every decision and action only the repo owner can take, including the questions below, is gathered with a checkbox in [Owner actions and decisions](../owner-actions.md).

- Do the `Symbols/alphanum` and `Symbols/geometric` subgroups stay in the Emoji Set? Excluding both takes it from 1,053 to 994. Decided in issue #23.
- Which flagged emoji are excluded after the side-by-side render check? Issue #23.
- Is three resends an hour the right limit? It is a starting value to tune, not a principle. As built (#82) it is one constant, `RESEND_LIMITS` in `packages/core/src/auth/resend-allowance.ts`, with an overridable parameter on the pure decision — so tuning it is a one-line change, and the sign-up link counts towards the three.
- Should 🍑 and 🍆 stay claimable? Both were left in ([#18](https://github.com/joshstothard/3moji/issues/18)) on the grounds that context makes them rude. ADR-0007 makes Food & Drink a launch category, so they are now prominent rather than buried among a thousand.
- Which order do later category drops go in, and what triggers one? ADR-0007 defers Objects and schedules nothing else.
- Are 🎉🎉🎉, 🎫🎫🎫 and 🍕🍕🍕 the right platform-owned Reserved Handles? They were chosen while implementing [#52](https://github.com/joshstothard/3moji/issues/52) and have never been confirmed as a product decision. 🧊🧊🧊 is deliberately not among them, because ADR-0004 decision 2 names it freely claimable.
- How is launch-day email volume handled? Resend's free plan caps email at 100 a day — one verification email per claim, plus resends and collision notices — so on launch day claimant 101 gets no email and their hold expires. The owner is undecided. **Recommendation:** launch quietly on Free, log the daily send count, and upgrade to Resend Pro ($20/month, 50,000 emails) together with Vercel Pro before any public announcement.
- Where do nightly database backups live? **Decided 2026-09-14:** an age-encrypted dump in a private Cloudflare R2 bucket (Decision log).

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
- 2026-09-13 — Three-of-a-kind Handles stay claimable, not reserved; an available one is celebrated as rare in the builder. Decided by the repo owner.
- 2026-09-13 — Error tracking uses Vercel's own logs, not a third-party vendor; the owner expects to move to Vercel Pro, which also lifts Hobby's non-commercial restriction. Decided by the repo owner.
- 2026-09-13 — The agent drafts the privacy notice and terms; the owner reviews them before launch. Decided by the repo owner.
- 2026-09-13 — Phase 7 is split: finding a Handle, the rare three-of-a-kind celebration, site hygiene and the operations minimum become Phase 8 — Findable, polished and operable, so Phase 7 holds only the launch-blocking owner return path and legal work. Decided by the repo owner when Phase 7 was planned.
- 2026-09-14 — When an open dropdown covers page text, axe checks only the open menu panel, and the full page is still checked with the menu closed. On Mobile Chrome, the four-row account menu covered the Profile's own text, so axe could not judge that text's contrast. `checkPage` in `apps/web/e2e/support/axe.ts` gained an optional `include` selector, and every other caller is unchanged (PR [#225](https://github.com/joshstothard/3moji/pull/225)). Taken by the orchestrator overnight, for owner review.
- 2026-09-14 — Resolving the spoken form in the path (e.g. `/three-ice-cubes`) was drafted as ADR-0011 and rejected by the repo owner as not needed for the MVP; spoken input is accepted by the Find a Handle lookup, offered on the home page and the 404 page. Revisit if post-launch logs show 404s on spoken-looking paths.
- 2026-09-14 — Instrumentation allowed for onRequestError only; tracing still forbidden pending #148. Decided by the repo owner.
- 2026-09-14 — HSTS stays without `preload` for now. Decided by the repo owner.
- 2026-09-14 — The production CSP smoke test runs in Chromium only. Decided by the repo owner.
- 2026-09-14 — The production smoke test runs `next start`, not the Docker image's standalone server, because the site deploys to Vercel. Decided by the orchestrator.
- 2026-09-14 — #233 (server-rendered Handle-route 404 without JavaScript) deferred as a Next.js limitation. Decided by the orchestrator, for owner review.
- 2026-09-14 — Canonical word aliases always name exactly one Handle: `displayName` slugs stay, and a curated `aliasName` is used for the five display names that also name another emoji, not the shortest term everywhere, which would publish wrong names. An alias with several candidates and none claimed lists the Handles that can be claimed. Accepted by the repo owner ([ADR-0011](../adr/0011-canonical-word-aliases-name-one-handle-and-unclaimed-aliases-list-claimable-handles.md))
- 2026-09-14 — Nightly database backups are an age-encrypted `pg_dump` in a private Cloudflare R2 bucket, kept 30 days by a bucket lifecycle rule. The dump is encrypted to an age public key held as a repository variable; the private key stays only in the owner's password manager and never goes to GitHub. A private GitHub repository was the alternative, and Actions artifacts were ruled out as public. Decided by the orchestrator at the owner's request ([#206](https://github.com/joshstothard/3moji/issues/206)).

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
- 2026-09-13 — #163 added to Phase 5 (epic #149): the Claim's case-sensitive email lookups disagree with Better Auth's lowercasing, which by the code path breaks non-enumeration and blocks mixed-case sign-ups. Found while landing #148 (PR #162); measured first.
- 2026-09-13 — Synced from GitHub after #188: **Phase 5 Done** (epic #149 closed, all 16 issues closed — #150–#158 and #163 as planned, plus #169, #177, #180, #182, #185 and #187 added after planning) and **Phase 6 Done** (epic #159 closed, #160 and #161 closed). All four Phase 5 and both Phase 6 acceptance criteria ticked against their closed issues. Not yet met despite the Done status: `3moji.me` is not live, so Phase 5's outcome and Phase 6's unfurl on a real share wait on #32 (blocked on #19); and Phase 5's error tracking was never planned as an issue. Phase 1 (#32) and Phase 2 (#55) remain In progress, so the workstream stays Active.
- 2026-09-13 — Phase 7 added after an MVP gap review: owner return path (password reset, account area, sign-out, deletion), privacy/terms/reporting, finding a Handle by its spoken form, a rare three-of-a-kind celebration, site hygiene and an operations minimum. The claim-collision email's dead `/reset-password` link recorded as a live bug.
- 2026-09-13 — Owner actions and decisions gathered into [`docs/owner-actions.md`](../owner-actions.md): setup only the owner can do, decisions due before launch, and decisions that can wait until after launch.
- 2026-09-13 — Phase 7 planned: epic #191, issues #192–#198. Phase 8 planned: epic #199, issues #200–#207.
- 2026-09-14 — Synced from GitHub: **Phase 7 Planned → Done** (epic #191 closed, all nine issues closed with #214 and #216 appended; privacy and terms are drafts pending owner review) and **Phase 8 Planned → In progress** (epic #199, 3 of 8 closed: #200, #202 and #204). #201, #203, #205 and #207 are partly merged and wait on owner decisions or #32, and #206 is blocked on #32. Nothing in either phase is verified on a live site, which waits on #32 (blocked on #19). The Decision log gains the overnight axe-scope call on #225.
- 2026-09-14 — #201 finished without an ADR: the owner declined resolving the spoken form in the path, the Phase 8 criterion is reworded to the Find a Handle lookup and ticked, and the branded 404 page now offers that lookup. #233 filed under epic #199: a `[handle]` 404 has no markup without JavaScript.
- 2026-09-14 — CSP: nonce on every page (option 1). Decided by the repo owner.
- 2026-09-14 — Synced after PR #235: #201, #203 and #205 done (PRs #234, #232, #235), the security-headers criterion ticked, #233 appended and deferred to Backlog, and four decisions logged (HSTS without `preload`, Chromium-only CSP smoke test, `next start` for the smoke test, #233 deferral). #206 and #207 stay blocked on #32; Phase 8 stays In progress.
- 2026-09-14 — ADR-0011 accepted: it partially supersedes ADR-0008 decisions 3 and 4, and removes the shorter-synonym open question. Implementation is a follow-up issue; the Phase 4 alias criterion stays unticked until it lands.
