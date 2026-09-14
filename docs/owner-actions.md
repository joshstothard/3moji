# Owner actions and decisions

**Last checked:** 2026-09-14, against `main` and GitHub
**Related:** [3moji MVP workstream](workstreams/3moji-mvp.md), [Authentication](architecture/auth.md), [Hosting and email report](reports/2026-09-11-hosting-and-email.md)

Everything on this page needs the repo owner. An agent can't do it, either because it needs your accounts, payment method, DNS or phones, or because it's a product or legal call that's yours to make. Tick an item when it's done, and record the outcome where its **Detail** line points, so this page never becomes the only record.

Items are grouped by when they have to happen:

- **Do before launch:** setup only you can do.
- **Decide before launch:** calls that are hard or impossible to undo once real people have claimed Handles, or that launch day needs.
- **Decide after launch:** calls that need real traffic to answer, or that don't affect people using the site.

"Launch" means announcing `3moji.me` publicly. A quiet, unannounced deploy can come first.

## Do before launch

- [x] **Create the hosting, database, email and DNS accounts** (done: confirmed by the owner on 2026-09-14, and [#19](https://github.com/joshstothard/3moji/issues/19) is closed)
  - **What:** Create a Vercel project linked to `joshstothard/3moji` (Hobby for now, Pro expected). Add Neon Postgres through the Vercel Marketplace, and check the Free plan can actually be picked in the install dialog. Set up Resend to send from a subdomain of `3moji.me`, not the bare domain. At GoDaddy, add the records Vercel gives you for `3moji.me` and `www`, and the SPF, DKIM and DMARC records for the Resend subdomain. Then note where the credentials are kept, but never the credentials themselves, and never in the repo or an issue.
  - **Why it matters:** nothing can go live until these accounts exist, and no agent can create them.
  - **Options:** for DMARC, `p=none` with reporting (you get reports and nothing is blocked), or `p=quarantine`/`p=reject` straight away (stricter, but a misconfiguration silently loses real verification emails).
  - **Recommendation:** start DMARC at `p=none` with a reporting address, and tighten it once the reports show only Resend sending for the subdomain. If Neon Free isn't selectable, stop and say so. The fallback, Supabase, would need a new ADR.
  - **Environment variables the app expects** (names only):
    - `DATABASE_URL`: the pooled connection. The Neon integration should inject it.
    - `DATABASE_URL_UNPOOLED`: the direct connection that migrations use. The Neon integration should inject it too.
    - `BETTER_AUTH_URL`: the site's public address. Verification and reset links are built from it.
    - `BETTER_AUTH_SECRET`: at least 32 random characters. Generate it, never make one up.
    - `RESEND_API_KEY`: from Resend.
    - `RESEND_FROM`: the sender, on the Resend subdomain.
    - `REPORT_CONTACT_EMAIL`: optional. Unset, or anything but one plain address, means no report link is shown. See "Create the abuse report alias" below.
    - `NEXT_PUBLIC_APP_VERSION` is supplied by the build and needs nothing from you. **Never set `TEST_EMAIL_SENDER` on Vercel**: it's test-only, and the app refuses to start with it set there.
    - `PRODUCTION_DATABASE_HOST`: **set it for Preview** ([#32](https://github.com/joshstothard/3moji/issues/32)). The host name of the production database, the part after `@` and before `/` in Production's `DATABASE_URL_UNPOOLED` (the pooled host works too). Copy it from the Vercel or Neon dashboard, never into the repo, an issue or a chat. Every preview build compares its own database against it and **fails if it is production, or if this is unset**, so a preview can never migrate or use production data. It's a host name, not a password, but treat it as private.
    - Vercel's own `VERCEL_ENV`, `VERCEL_URL` and `VERCEL_BRANCH_URL` need "Automatically expose System Environment Variables" left on. A preview builds its verification and reset links from them, because `BETTER_AUTH_URL` holds the production address.
  - **Vercel project settings** (Settings → Build and Deployment), for the build in `apps/web/vercel.json` ([#32](https://github.com/joshstothard/3moji/issues/32)):
    - **Root Directory:** `apps/web`. `vercel.json` is read from there.
    - **Include files outside the root directory in the Build Step:** on. The build needs `packages/` and `scripts/`.
    - **Framework Preset:** Next.js.
    - **Build Command, Install Command and Output Directory:** leave the overrides off. `vercel.json` sets the first two, and the output is Next.js's default, `.next` in `apps/web`.
    - **Node.js Version:** 24.x, to match `engines` in the root `package.json`.
    - **Don't set `NODE_ENV=production` or `NPM_CONFIG_PRODUCTION=true` as Vercel environment variables.** The build needs devDependencies (turbo and drizzle-kit), and without them it fails with an unhelpful "not found".
    - **Neon integration:** connected for Production and Preview, with a database branch per preview deployment turned on.
    - What a build does with them, and when it fails on purpose, is in [system-overview.md § The build](architecture/system-overview.md#the-build). A failed build's reason is in its build log, on a line starting `[vercel-migrate]`.
  - **Blocks:** [#32](https://github.com/joshstothard/3moji/issues/32), the first deploy. That in turn blocks every "on the live site" check, including dotted alias paths on Vercel's CDN, backups and uptime.
  - **Detail:** [#19](https://github.com/joshstothard/3moji/issues/19) (the checklist; the repo rename on it is already done), [hosting and email report](reports/2026-09-11-hosting-and-email.md) § 5 for the exact DNS records, `apps/web/.env.example`.

- [ ] **Do the emoji render check on two real phones**
  - **What:** Open the eleven flagged emoji side by side on an iPhone and an Android phone, and decide which (if any) look too different to keep.
  - **Why it matters:** once someone claims a Handle with an excluded emoji, removing that emoji either orphans the Handle or breaks the Reserved Handle rule.
  - **Options:** exclude some, or exclude none. "Nothing needs excluding" is a valid, recorded outcome.
  - **Recommendation:** none. It needs eyes on devices. Only 🔫 of the eleven is in a released category today, so the check is quick.
  - **Blocks:** [#55](https://github.com/joshstothard/3moji/issues/55), the agent work that applies your verdict. #55 must land before the site is open to anyone.
  - **Detail:** [#23](https://github.com/joshstothard/3moji/issues/23) (the list and how to do it).

- [x] **Turn on secret scanning with push protection** (done: confirmed by the owner on 2026-09-14)
  - **What:** In the repo's Settings → Code security, turn on secret scanning and push protection. Both were off until 2026-09-14.
  - **Why it matters:** the repo is public, so a leaked key is compromised the moment it's pushed, and push protection is the one guard a missing local hook or `--no-verify` can't skip.
  - **Options:** turn it on, or rely only on the local `secretlint` hook (which a fresh worktree can silently lack).
  - **Recommendation:** turn it on. It's free for public repositories.
  - **Blocks:** nothing directly, but it covers the risk that [#126](https://github.com/joshstothard/3moji/issues/126) only narrows.
  - **Detail:** [#126](https://github.com/joshstothard/3moji/issues/126) § Notes, `docs/development/local-setup.md`, `AGENTS.md` § This Repository Is Public.

- [x] **Protect `main` and make the Format check required** (done: confirmed by the owner on 2026-09-14)
  - **What:** `main` had no branch protection and no ruleset until 2026-09-14. Create one and add the CI `Format` job as a required check.
  - **Why it matters:** the auto-merge gate already waits for the whole CI run, but nothing stops a hand merge with unformatted code, which is how `main` went red before.
  - **Options:** a classic branch protection rule, or a repository ruleset. Either needs a settings change only you can make.
  - **Recommendation:** add it. [ADR-0003](adr/0003-auto-merge-pull-requests-on-green-ci.md) chose a workflow gate because protection was unavailable while the repo was private. The repo is public now, but it isn't confirmed whether that makes protection available on your plan, and native protection would need a new ADR.
  - **Blocks:** nothing.
  - **Detail:** PR [#122](https://github.com/joshstothard/3moji/pull/122), which added the `Format` job to `.github/workflows/ci.yml`.

- [x] **Enable Web Analytics in Vercel** (done: confirmed by the owner on 2026-09-14)
  - **What:** In the Vercel project, open Analytics and select Enable. The `<Analytics />` component is already in the root layout, but Vercel records nothing until it is enabled there.
  - **Why it matters:** without it, the page-view analytics the privacy notice describes never starts.
  - **Options:** enable it, or leave it off (the component then does nothing).
  - **Recommendation:** enable it with the first deploy.
  - **Blocks:** nothing.
  - **Detail:** PR [#238](https://github.com/joshstothard/3moji/pull/238), [Vercel Web Analytics quickstart](https://vercel.com/docs/analytics/quickstart).

- [ ] **Create the abuse report alias and point `REPORT_CONTACT_EMAIL` at it**
  - **What:** Create a dedicated forwarding alias on `3moji.me` that forwards to you. It is shown here only as the placeholder `reports@example.com`, and the real address never goes in the repo or an issue. Then set `REPORT_CONTACT_EMAIL` in Vercel (Production) to that one plain address, and redeploy: prerendered pages read it at build time.
  - **Why it matters:** the report link on every Profile and in the footer shows nothing until the variable is set. The takedown runbook now commits to acknowledging a report within 48 hours.
  - **Options:** none left open. The alias was decided on 2026-09-14 (below).
  - **Recommendation:** set it up with the first deploy, then send yourself a test report from a Profile to check the alias forwards.
  - **Blocks:** the report link going live ([#197](https://github.com/joshstothard/3moji/issues/197), [#198](https://github.com/joshstothard/3moji/issues/198)), and so the public announcement.
  - **Detail:** [takedown runbook](runbooks/takedown.md) § 1, `apps/web/.env.example`.

- [ ] **Optional: register the sending domain with Google Postmaster Tools, and check Microsoft SNDS**
  - **What:** The first live verification email landed in Outlook's Junk folder ([#240](https://github.com/joshstothard/3moji/issues/240)). Every email is now multipart text and HTML, which should help. To see how providers rate the domain:
    - **Google Postmaster Tools:** add `mail.3moji.me` (or `3moji.me`) and verify it with the TXT record Google gives you, at GoDaddy. Nothing in the app changes.
    - **Microsoft SNDS:** it registers sending IP addresses, not domains. Resend sends from shared IP addresses, so you may not be able to register anything. Check, and if not, note that here.
  - **Why it matters:** junk filtering never shows in the app's logs, and Resend reports a junked email as delivered. These dashboards are the only view of the domain's reputation.
  - **Options:** register now, so there is history when it is needed; register only if junking keeps happening; or skip it.
  - **Recommendation:** register with Google Postmaster Tools now. It is free, takes one DNS record, and a new domain needs the history. Check SNDS once, and record whether it is usable with Resend.
  - **Blocks:** nothing.
  - **Detail:** [Email not arriving § 5d](runbooks/email-not-arriving.md#5d-landing-in-junk).

## Decide before launch

- [ ] **Launch-day email volume: stay on Resend Free, or pay for Pro**
  - **What:** Resend's free plan sends at most 100 emails a day. That covers one verification email per claim, plus resends and "you already have an account" notices.
  - **Why it matters:** on a busy day, claimant 101 gets no email, and their held Handle expires after 24 hours.
  - **Options:** stay on Free, or move to Resend Pro ($20/month, 50,000 emails).
  - **Recommendation:** launch quietly on Free and log the daily send count. Move to Resend Pro together with Vercel Pro before any public announcement.
  - **Blocks:** the public announcement.
  - **Detail:** [workstream](workstreams/3moji-mvp.md) Open questions and Risks, [hosting and email report](reports/2026-09-11-hosting-and-email.md) § 5.

- [ ] **When to move to Vercel Pro**
  - **What:** You expect to upgrade from Hobby to Pro.
  - **Why it matters:** Hobby is non-commercial only and keeps runtime logs for one hour, so an incident has to be debugged within the hour.
  - **Options:** upgrade before the announcement, or stay on Hobby until something forces it.
  - **Recommendation:** upgrade with Resend Pro, before announcing. Pro is expected to add log drains and longer log retention, but **that needs confirming against Vercel's current docs**. It hasn't been verified here.
  - **Blocks:** error tracking (it uses Vercel's own logs, and waits on this), and any paid feature.
  - **Detail:** [workstream](workstreams/3moji-mvp.md) Phase 8, deliverable 4; [hosting and email report](reports/2026-09-11-hosting-and-email.md) § 4.

- [ ] **Where nightly database backups are stored**
  - **What:** Neon's free plan can only restore to a point in the last 6 hours or so. A mistake noticed the next day, such as a bad migration or an accidental deletion, would lose every Handle, Account and Profile. A nightly copy kept somewhere else fixes that.
  - **Why it matters:** without it, one bad day could permanently wipe out every claimed Handle.
  - **Options:**
    - An encrypted database dump in a private S3-compatible bucket, such as Cloudflare R2's free tier.
    - A private GitHub repository.
    - GitHub Actions artifacts on this repo are **ruled out**: on a public repository anyone can download them.
  - **Recommendation:** an encrypted dump in a private Cloudflare R2 bucket.
  - **Blocks:** Phase 8's backup job and its "restore from backup" runbook. The job itself also waits on [#32](https://github.com/joshstothard/3moji/issues/32).
  - **Detail:** [workstream](workstreams/3moji-mvp.md) Open questions and Phase 8, deliverable 4; [hosting and email report](reports/2026-09-11-hosting-and-email.md) § 2 (restore window).

- [ ] **Review the privacy notice and terms, and confirm the legal checks**
  - **What:** In Phase 7 the agent drafts `/privacy` and `/terms` in plain English. You review them before announcing. You also check whether the ICO data protection fee applies to you, and confirm Phase 7's written assessment, citing Ofcom, of whether the Online Safety Act's user-to-user duties apply ([takedown runbook](runbooks/takedown.md) § 6).
  - **Why it matters:** the site collects email addresses and IP addresses and publishes user content, from a UK-based owner.
  - **Options:** review them yourself, or pay for a legal review.
  - **Recommendation:** review the drafts yourself. Use the ICO's fee self-assessment and Ofcom's Regulation Checker for the two checks. The workstream's own reading is that the Online Safety Act _likely_ applies, but that's an inference, not a conclusion.
  - **Blocks:** the public announcement.
  - **Detail:** [workstream](workstreams/3moji-mvp.md) Phase 7, deliverable 3.

- [ ] **Review the privacy notice and terms before removing the draft marker**
  - **What:** `/privacy` and `/terms` show "Draft — pending owner review" until you remove the marker (`DraftMarker` in `apps/web/src/components/legal-document.tsx`). Answer these first. The ICO fee and the Online Safety Act are in the item above.
    1. **Operator identity and contact:** the controller name and contact address that replace `Legal.operatorPlaceholder` and `Legal.contactPlaceholder`. The contact could be the `REPORT_CONTACT_EMAIL` mailbox.
    2. **Processor locations and transfers:** where Vercel, Neon and Resend process data, and the safeguards for any transfer outside the UK. Nothing in the repo establishes this.
    3. **Lawful basis for each purpose:** as drafted, contract for the account and Profile, and legitimate interests for sessions, counters and logs.
    4. **`verification_dispatch` retention:** kept for the life of the account. Should it be pruned?
    5. **Log and backup retention:** how long Vercel logs and Neon backups keep data on your plans. The page says only "for a limited time".
    6. **Cookies:** confirm that no analytics or other cookies are added before launch. Today there are only Better Auth's session cookies. Vercel Web Analytics, added in PR [#238](https://github.com/joshstothard/3moji/pull/238), does not use cookies, so it does not change this.
    7. **Minimum age** for claiming a Handle (a placeholder in the terms).
    8. **Governing law:** England and Wales, Scotland or Northern Ireland. Also the "last updated" dates.
    9. **Limitation of liability wording**, ideally with legal advice.
    10. **The "within one month" reply** to rights requests, the UK GDPR default: confirm you can meet it.
  - **Why it matters:** the pages are an agent's plain-English draft, and nobody with legal training has reviewed them. The footer and claim form now link to them from every page ([#198](https://github.com/joshstothard/3moji/issues/198)).
  - **Options:** answer each yourself, or take the list to a legal review.
  - **Recommendation:** none recorded beyond the item above.
  - **Blocks:** removing the draft marker, and so the public announcement.
  - **Detail:** PR [#210](https://github.com/joshstothard/3moji/pull/210) § Questions the owner must answer; `packages/shared/messages/en.json` `Legal` namespace.

## Decide after launch

- [ ] **Limit sign-in attempts per Account, not only per client**
  - **What:** Sign-in is limited per client IP address. There's no limit per Account, so many machines could each guess one Account's password slowly.
  - **Why it matters:** a per-Account limit slows that kind of guessing, but it lets anyone who knows your email address lock you out of your own Account.
  - **Options:** leave it out (today), or add a conservative per-Account limit counted on every attempt, with password reset as the way back in.
  - **Recommendation:** leave it out until the logs show slow, distributed guessing, which a site with no traffic can't show.
  - **Blocks:** nothing.
  - **Detail:** [auth architecture](architecture/auth.md) § Per-account limiting: not implemented.

- [ ] **The order and trigger for releasing more emoji categories**
  - **What:** Three categories are released: Food & Drink, Animals & Nature, and Activities. Nothing schedules the rest. ADR-0007 defers Objects and says nothing about the others.
  - **Why it matters:** each release adds Handles people can claim, and the timing shapes interest and squatting.
  - **Options:** a fixed order and schedule, or releases triggered by something like claim volume.
  - **Recommendation:** none recorded. Decide once there are claims to look at.
  - **Blocks:** nothing at launch.
  - **Detail:** [ADR-0007](adr/0007-release-the-emoji-set-in-category-drops.md), [workstream](workstreams/3moji-mvp.md) Open questions.

- [ ] **How a new worktree gets its git hooks**
  - **What:** A git worktree created without `npm install` has no git hooks, and git doesn't say so. Running `npm install` in one worktree can also switch off hooks for the others.
  - **Why it matters:** local checks, including the secret scan, can silently not run. This affects development, not people using the site.
  - **Options:**
    1. A per-worktree hooks setting applied automatically when a worktree is created.
    2. A script that re-applies the setting after every install.
    3. Accept it and rely on the existing warning.
    4. Commit the hooks folder.
  - **Recommendation:** the issue leans to option 1, and says secret scanning with push protection (above) matters more than any of them.
  - **Blocks:** nothing.
  - **Detail:** [#126](https://github.com/joshstothard/3moji/issues/126).

- [ ] **The look of form field borders**
  - **What:** Text fields and builder buttons now have a darker mid-grey border (`#62748e`, `slate-500`) so they meet WCAG AA contrast. No lighter grey in the palette passes.
  - **Why it matters:** it's a visible design change made for accessibility, and the lighter look can only come back another way.
  - **Options:** keep the darker border, or use a tinted fill that itself contrasts 3:1 with the page.
  - **Recommendation:** keep it. It passes and it's already tested. Revisit only if you want the lighter look.
  - **Blocks:** nothing.
  - **Detail:** PR [#184](https://github.com/joshstothard/3moji/pull/184) § For the repo owner, PR [#186](https://github.com/joshstothard/3moji/pull/186).

## Already decided: don't reopen

Recorded in the [workstream](workstreams/3moji-mvp.md) Decision log on 2026-09-13:

- **Three-of-a-kind Handles stay claimable**, and an available one gets a short "rare" animation in the builder.
- **Error tracking uses Vercel's own logs**, not a third-party service. The fuller version waits on Vercel Pro.
- **The agent drafts the privacy notice and terms, and you review them** before launch.

Recorded in the Decision log on 2026-09-14:

- **The spoken form isn't resolved in the path** ([#201](https://github.com/joshstothard/3moji/issues/201)). `/three-ice-cubes` stays a 404 and ADR-0008 stands. Spoken input works in the Find a Handle lookup, which the home page and the 404 page both offer. Revisit if post-launch logs show 404s on spoken-looking paths.
- **The Content Security Policy is a per-request nonce on every page** (option 1 of [#205](https://github.com/joshstothard/3moji/issues/205#issuecomment-5656525123)). `/`, `/privacy`, `/terms` and the 404 render per request and lose CDN caching in exchange for a strict policy with no `unsafe-inline` script. See [Security headers](architecture/system-overview.md#security-headers).
- **Vercel Web Analytics was added at your request** (PR [#238](https://github.com/joshstothard/3moji/pull/238)). It is cookieless, and the privacy notice's processors section was updated to say what it records, from Vercel's own docs. Its URL recording would have included the set-new-password page, whose address holds a reset token, so **every URL is redacted before it is sent**: `/reset-password/<token>` becomes `/reset-password/[token]`, every query string and fragment is dropped, and a URL that cannot be parsed is not sent at all. See `apps/web/src/lib/analytics-redaction.ts`, tested in `apps/web/src/lib/analytics-redaction.test.ts`, and wired in by `SiteAnalytics` (asserted in `apps/web/src/components/site-analytics.test.tsx` and `apps/web/src/app/layout.test.tsx`).

Accepted by the owner on 2026-09-14, from the recommendations this page made ([#244](https://github.com/joshstothard/3moji/issues/244)), and recorded in the Decision log the same day:

- **Abuse reports go to a dedicated forwarding alias, not a personal inbox.** It can change hands later, and it keeps your own address private. `REPORT_CONTACT_EMAIL` in Vercel points at it. Creating the alias is still to do, under Do before launch. Detail: [takedown runbook](runbooks/takedown.md), [workstream](workstreams/3moji-mvp.md) Phase 7, deliverable 3.
- **Reports are acknowledged within 48 hours, and "act now" reports are acted on within 24 hours.** "Act now" is the takedown runbook's triage row for child sexual abuse material, terrorism content, credible threats, and live phishing or malware Links. A `mailto:` link is enough for launch, and no web form is needed before launch. The [takedown runbook](runbooks/takedown.md) states this as the commitment in § 1, § 2b and § 6. Detail: PR [#211](https://github.com/joshstothard/3moji/pull/211).
- **The rate limits keep their current starting values for launch**, and are tuned from the logs afterwards. Each one is a one-line constant:
  - Claiming a Handle: 3 an hour per email address and 10 an hour per client IP address (`CLAIM_RATE_LIMITS`).
  - Sign-in: 10 in 15 minutes per client (`AUTH_RATE_LIMITS.signInEmail`).
  - Password reset and verification emails: 5 an hour per client each (`AUTH_RATE_LIMITS`).
  - Resending a verification link: 10 an hour per client IP address (`RESEND_CLIENT_RATE_LIMIT`), plus 3 an hour per Account at least 60 seconds apart (`RESEND_LIMITS`).
  - The password reset request form: 5 an hour per client (`RESET_REQUEST_CLIENT_RATE_LIMIT`).
  - Every other Better Auth endpoint: 100 in 10 seconds per client.
  - Detail: [auth architecture](architecture/auth.md) § Resend, and its limits, § Better Auth's rate limit, § The Claim's rate limit; `packages/core/src/handle/claim-rate-limit.ts`, `packages/core/src/auth/`.
- **Password reset stays privacy-safe, and the code already works this way.** Checked against `main` on 2026-09-14, so no code change is needed:
  - **The request page says the same thing whether or not the send succeeds.** `requestPasswordReset` in `packages/core/src/auth/password-reset.ts` answers `sent` for a registered address and an unregistered one alike, before any email goes out. The page shows that as "If that address belongs to an account, a reset link is on its way" (`PasswordReset.requestSent` in `packages/shared/messages/en.json`). It shows "We could not send a reset link just now" (`?notice=failed`) only when the request fails before any email is handed off, for example when the rate limiter or the database can't be reached (`apps/web/src/components/password-reset-action.ts`). A failed send never produces it.
  - **The email is sent in the background, and a failure is only logged.** The auth instance's sender is `createBackgroundEmailSender` (`packages/core/src/auth/adapters/background-email-sender.ts`, wired in `packages/core/src/composition-root.ts`). `createAfterBackgroundTasks` (`apps/web/src/lib/after-background-tasks.ts`) runs the send with Next.js's `after()` and logs a failure as `auth_email_send_failed`, and that's all ([#216](https://github.com/joshstothard/3moji/issues/216)).
  - **The set-new-password form has no limit of its own.** `setNewPassword` in `password-reset.ts` checks no limiter. What it guards is a random 24-character token that expires in an hour.
  - Detail: PR [#215](https://github.com/joshstothard/3moji/pull/215) § Open questions for the owner, [auth architecture](architecture/auth.md) § Password reset.
- **A failed email no longer tells the person it failed.** They can ask again from the page they're already on. Alerting on `auth_email_send_failed`, `claim_collision_email_failed` and `claim_verification_email_failed` waits for Phase 8's error tracking. Detail: [Authentication](architecture/auth.md#what-an-operator-sees-when-a-send-fails).
- **The emoji picker's category and emoji buttons get the `slate-500` border** the builder's slots have, rather than relying on the label or the emoji to identify each button. It's being built under its own issue. Detail: PR [#186](https://github.com/joshstothard/3moji/pull/186) § For the owner to decide, `apps/web/src/components/emoji-picker.tsx`.
- **The "letters" (`Symbols/alphanum`) and "shapes" (`Symbols/geometric`) groups stay in the Emoji Set**, so the full set stays at 1,053. Detail: [#23](https://github.com/joshstothard/3moji/issues/23) § Two whole subgroups.
- **🍑 and 🍆 stay claimable.** Misuse is handled through reports ([takedown runbook](runbooks/takedown.md)). Detail: [#18](https://github.com/joshstothard/3moji/issues/18).
- **🎉🎉🎉, 🎫🎫🎫 and 🍕🍕🍕 are the platform's Reserved Handles.** 🧊🧊🧊 stays claimable. Detail: [#52](https://github.com/joshstothard/3moji/issues/52).
- **Axe's check on the open account menu stays scoped.** When an open dropdown covers page text, axe checks only the open menu panel, and it still checks the whole page with the menu closed (`checkPage`'s optional `include` in `apps/web/e2e/support/axe.ts`). Detail: PR [#225](https://github.com/joshstothard/3moji/pull/225) follow-up comments, [workstream](workstreams/3moji-mvp.md) Decision log.

Accepted by the owner on 2026-09-14 ([#244](https://github.com/joshstothard/3moji/issues/244)), and **awaiting ADR**. [ADR-0008](adr/0008-handles-are-addressable-by-emoji-and-by-their-word-alias.md) is Accepted and can't be edited, so nothing changes until you run the `/adr` command below, which drafts a new ADR that partially supersedes it. Tick each item once its ADR is accepted. Run them one at a time. The first one marks ADR-0008 as partially superseded, and the `adr` skill stops when the ADR it supersedes isn't plain Accepted. When it stops, tell it the second ADR supersedes a different decision in ADR-0008.

- [ ] **The shareable word address prefers a shorter synonym where it matches only one Handle** (awaiting ADR)
  - **What:** today 🍎🍎🍎's canonical word address is `red-apple.red-apple.red-apple`, built from display names. This changes ADR-0008 decision 3.
  - **Run:** `/adr Prefer a shorter unambiguous synonym for a Handle's canonical word address --supersedes 0008`
  - **Blocks:** nothing technical, but links shared after launch fix the spelling, so it's worth doing before launch.
  - **Detail:** [ADR-0008](adr/0008-handles-are-addressable-by-emoji-and-by-their-word-alias.md) decision 3, [workstream](workstreams/3moji-mvp.md) Open questions.
- [ ] **A word address that matches several unclaimed Handles shows a listing of them, each with a claim button** (option 1; awaiting ADR)
  - **What:** fills the gap in ADR-0008 decision 4 when none of the Handles an alias names is claimed.
  - **Run:** `/adr Show a listing of unclaimed candidates when a word address matches several Handles and none is claimed --supersedes 0008`
  - **Blocks:** one of Phase 4's acceptance criteria, which stays unticked until then.
  - **Detail:** [#121](https://github.com/joshstothard/3moji/issues/121), where the decision is recorded as a comment.
