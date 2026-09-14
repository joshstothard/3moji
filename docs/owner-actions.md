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

- [ ] **Create the hosting, database, email and DNS accounts**
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
    - `REPORT_CONTACT_EMAIL`: optional. Unset, or anything but one plain address, means no report link is shown. See the report mailbox item below.
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

- [ ] **Turn on secret scanning with push protection**
  - **What:** In the repo's Settings → Code security, turn on secret scanning and push protection. Both are off today.
  - **Why it matters:** the repo is public, so a leaked key is compromised the moment it's pushed, and push protection is the one guard a missing local hook or `--no-verify` can't skip.
  - **Options:** turn it on, or rely only on the local `secretlint` hook (which a fresh worktree can silently lack).
  - **Recommendation:** turn it on. It's free for public repositories.
  - **Blocks:** nothing directly, but it covers the risk that [#126](https://github.com/joshstothard/3moji/issues/126) only narrows.
  - **Detail:** [#126](https://github.com/joshstothard/3moji/issues/126) § Notes, `docs/development/local-setup.md`, `AGENTS.md` § This Repository Is Public.

- [ ] **Protect `main` and make the Format check required**
  - **What:** `main` has no branch protection and no ruleset today. Create one and add the CI `Format` job as a required check.
  - **Why it matters:** the auto-merge gate already waits for the whole CI run, but nothing stops a hand merge with unformatted code, which is how `main` went red before.
  - **Options:** a classic branch protection rule, or a repository ruleset. Either needs a settings change only you can make.
  - **Recommendation:** add it. [ADR-0003](adr/0003-auto-merge-pull-requests-on-green-ci.md) chose a workflow gate because protection was unavailable while the repo was private. The repo is public now, but it isn't confirmed whether that makes protection available on your plan, and native protection would need a new ADR.
  - **Blocks:** nothing.
  - **Detail:** PR [#122](https://github.com/joshstothard/3moji/pull/122), which added the `Format` job to `.github/workflows/ci.yml`.

- [ ] **Enable Web Analytics in Vercel**
  - **What:** In the Vercel project, open Analytics and select Enable. The `<Analytics />` component is already in the root layout, but Vercel records nothing until it is enabled there.
  - **Why it matters:** without it, the page-view analytics the privacy notice describes never starts.
  - **Options:** enable it, or leave it off (the component then does nothing).
  - **Recommendation:** enable it with the first deploy.
  - **Blocks:** nothing.
  - **Detail:** PR [#238](https://github.com/joshstothard/3moji/pull/238), [Vercel Web Analytics quickstart](https://vercel.com/docs/analytics/quickstart).

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

- [ ] **Pick the mailbox abuse reports go to**
  - **What:** Every Profile will have a "report" link that opens an email to a contact address. The address is read from an environment variable, proposed as `REPORT_CONTACT_EMAIL`.
  - **Why it matters:** reports about phishing or abuse need to reach someone promptly, and the address is shown publicly.
  - **Options:** a dedicated alias (for example on `3moji.me`), or a personal inbox.
  - **Recommendation:** a dedicated alias that forwards to you, not a personal inbox. It can change hands later and keeps your own address private.
  - **Blocks:** the report link going live. It is built ([#197](https://github.com/joshstothard/3moji/issues/197)) and shows nothing until the variable is set.
  - **Detail:** [takedown runbook](runbooks/takedown.md), [workstream](workstreams/3moji-mvp.md) Phase 7, deliverable 3.

- [ ] **Confirm the report response targets, and whether a mailto is enough**
  - **What:** Two calls about handling reports:
    - **Response targets.** The takedown runbook proposes acknowledging a report within 2 working days, and acting the same day on anything in its "act now" triage row. These are starting values, not yet a commitment.
    - **A web form.** Reporting is a `mailto:` link, which needs a mail client. The runbook's Online Safety Act table marks "let users easily report illegal content" as only partly met, because a web form may be expected later.
  - **Why it matters:** a target you can't meet is worse than none once it's published. A reporter with no mail client set up has no way to report.
  - **Options:** accept the targets or change them. Keep the mailto for launch, or ask for a report form before launch.
  - **Recommendation:** none recorded.
  - **Blocks:** publishing any response time. A form would be a new issue.
  - **Detail:** PR [#211](https://github.com/joshstothard/3moji/pull/211), [takedown runbook](runbooks/takedown.md) § 1 and § 6.

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
    1. ~~**Operator identity and contact**~~ — answered 2026-09-14 ([#242](https://github.com/joshstothard/3moji/issues/242)). The pages name Joshua Stothard. The contact is **`REPORT_CONTACT_EMAIL`**, rendered as a `mailto:` link when the page loads, so the same mailbox now receives abuse reports _and_ privacy and terms enquiries. **You set its value in the Vercel project's environment variables**; it is never committed. Unset or refused, the pages show the bracketed contact placeholder.
    2. **Processor locations and transfers:** filled from the providers' own pages in [#242](https://github.com/joshstothard/3moji/issues/242). **Still yours:** check which region the Neon database is in (Neon console, project settings) and replace the bracketed Neon region placeholder.
    3. ~~**Lawful basis for each purpose**~~ — filled in [#242](https://github.com/joshstothard/3moji/issues/242): contract for the account, Handle and Profile; legitimate interests for security, rate limits and logs, and for page-view analytics.
    4. **`verification_dispatch` retention:** kept for the life of the account. Should it be pruned?
    5. ~~**Log and backup retention**~~ — filled in [#242](https://github.com/joshstothard/3moji/issues/242): Vercel runtime logs 1 hour, Vercel analytics at least a month, Neon history 6 hours, Resend 30 days. **If nightly backups are added, the privacy notice must say where they are kept and for how long.**
    6. **Cookies:** confirm that no analytics or other cookies are added before launch. Today there are only Better Auth's session cookies. Vercel Web Analytics, added in PR [#238](https://github.com/joshstothard/3moji/pull/238), does not use cookies, so it does not change this.
    7. ~~**Minimum age**~~ — set at **16** by the orchestrator in [#242](https://github.com/joshstothard/3moji/issues/242), because you had no view. The reason: every Profile is public, can carry any outbound link, and nobody moderates Profiles, so the service is not suited to younger children. Change the number in the terms if you disagree.
    8. **Governing law:** the terms now say England and Wales. **This is an assumption for you to confirm**, or change to Scotland or Northern Ireland. The "last updated" dates are set to 14 September 2026.
    9. **Limitation of liability wording:** short plain wording is drafted in [#242](https://github.com/joshstothard/3moji/issues/242). It does not exclude liability for death or personal injury caused by negligence, for fraud, or for anything the law does not allow to be excluded. Legal advice on it is still recommended.
    10. **The "within one month" reply** to rights requests, the UK GDPR default: confirm you can meet it.
  - **Why it matters:** the pages are an agent's plain-English draft, and nobody with legal training has reviewed them. The footer and claim form now link to them from every page ([#198](https://github.com/joshstothard/3moji/issues/198)).
  - **Options:** answer each yourself, or take the list to a legal review.
  - **Recommendation:** none recorded beyond the item above.
  - **Blocks:** removing the draft marker, and so the public announcement.
  - **Detail:** PR [#210](https://github.com/joshstothard/3moji/pull/210) § Questions the owner must answer; `packages/shared/messages/en.json` `Legal` namespace.

- [ ] **Confirm the rate-limit starting values**
  - **What:** The limits below are in code today. Each was flagged as a starting value for you to confirm. Changing one is a one-line constant, so this isn't a one-way door.
    - **Claiming a Handle:** 3 an hour per email address, 10 an hour per client IP address (`CLAIM_RATE_LIMITS`).
    - **Sign-in:** 10 in 15 minutes per client (`AUTH_RATE_LIMITS.signInEmail`; the sign-in form uses the same numbers).
    - **Password reset email and verification email:** 5 an hour per client each (`AUTH_RATE_LIMITS`).
    - **Resending a verification link:** 10 an hour per client IP address (`RESEND_CLIENT_RATE_LIMIT`), plus 3 an hour per Account with at least 60 seconds between them, the sign-up email included (`RESEND_LIMITS`).
    - **The password reset request form:** 5 an hour per client (`RESET_REQUEST_CLIENT_RATE_LIMIT`), taken from `AUTH_RATE_LIMITS.requestPasswordReset` rather than set separately ([#192](https://github.com/joshstothard/3moji/issues/192)).
    - **Every other Better Auth endpoint:** 100 in 10 seconds per client (Better Auth's own default, stated explicitly).
  - **Why it matters:** too tight and real people get locked out on launch day; too loose and someone can use the site to spam inboxes or guess passwords.
  - **Options:** accept them as they are, or change individual values.
  - **Recommendation:** accept them for launch, then tune them from the logs.
  - **Blocks:** nothing.
  - **Detail:** [auth architecture](architecture/auth.md) § Resend, and its limits, § Better Auth's rate limit, § The Claim's rate limit; `packages/core/src/handle/claim-rate-limit.ts`, `packages/core/src/auth/`.

- [ ] **How the password reset pages trade enumeration safety against honesty**
  - **What:** Three calls left open when the reset pages were built:
    1. **The answer when a send fails.** If Resend is down, a registered address gets "failed" while an unregistered one still gets "sent", so an outage reveals which addresses have accounts. Resend and Better Auth's own endpoint behave the same way. The alternative is to always answer "sent" and only log the failure, which hides the outage from the person waiting for the email.
    2. **Sending in the background.** The 500 ms floor pads fast answers, but a real send that takes longer is still measurably slower. Sending with `waitUntil` would close that gap, at the cost of never learning that a send failed.
    3. **No limit on the set-new-password form.** It guards a 24-character random token that expires in an hour, and bypasses Better Auth's HTTP limiter. Should it get its own limit?
  - **Why it matters:** each choice trades not revealing who has an account against telling a real person that something went wrong.
  - **Options:** keep the behaviour as built, or change any of the three.
  - **Recommendation:** none recorded.
  - **Blocks:** nothing technical.
  - **Detail:** PR [#215](https://github.com/joshstothard/3moji/pull/215) § Open questions for the owner, [auth architecture](architecture/auth.md) § Password reset.

- [ ] **Emoji picker buttons with no border**
  - **What:** The picker's category buttons and emoji buttons have a white fill on a near-white page (about 1.05:1 contrast) and no border.
  - **Why it matters:** WCAG AA asks for 3:1 on whatever identifies a control, unless something else (here the text label or the emoji itself) does that job.
  - **Options:** accept that the label or glyph identifies each button, and record why. Or add the same `slate-500` border the other controls now have.
  - **Recommendation:** none recorded. It's a design call. Note the builder's slots were given a border rather than relying on the glyph.
  - **Blocks:** nothing, though AA is a stated success criterion.
  - **Detail:** PR [#186](https://github.com/joshstothard/3moji/pull/186) § For the owner to decide, `apps/web/src/components/emoji-picker.tsx`.

- [ ] **Do the "letters" and "shapes" emoji groups stay in the set?**
  - **What:** Two groups describe text or shapes rather than a picture. One is `Symbols/alphanum`, such as 🆎 "AB button". The other is `Symbols/geometric`, such as "red circle" vs "red square". Excluding both takes the full set from 1,053 to 994.
  - **Why it matters:** these are hard to say aloud, and saying a Handle out loud is the product.
  - **Options:** keep both, drop one, or drop both.
  - **Recommendation:** none recorded. This doesn't need the phones.
  - **Blocks:** freezing the Emoji Set. Neither group is in a released category yet, so this must be settled before any category containing them is released.
  - **Detail:** [#23](https://github.com/joshstothard/3moji/issues/23) § Two whole subgroups, [workstream](workstreams/3moji-mvp.md) Open questions.

- [ ] **Should 🍑 and 🍆 stay claimable?**
  - **What:** Both were left in, on the grounds that context is what makes them rude. Food & Drink is now a launch category, so they're prominent rather than buried.
  - **Why it matters:** removing them after someone has claimed a Handle with one is the same one-way door as the render check.
  - **Options:** keep them claimable, or add them to the blocked list.
  - **Recommendation:** none recorded.
  - **Blocks:** nothing technical, but it must be settled before claims open.
  - **Detail:** [#18](https://github.com/joshstothard/3moji/issues/18), [workstream](workstreams/3moji-mvp.md) Open questions.

- [ ] **Should the shareable word address prefer a shorter name?**
  - **What:** Each Handle has one canonical word address built from display names, so 🍎🍎🍎 is `red-apple.red-apple.red-apple`. The shorter `apple.apple.apple` already works when typed, but it matches eight Handles.
  - **Why it matters:** once people have shared a link in bios and chats, changing its canonical spelling makes old links redirect or break.
  - **Options:** keep the display-name form, or prefer a shorter synonym where it matches only one Handle.
  - **Recommendation:** none recorded.
  - **Blocks:** nothing technical, but links shared after launch fix the spelling.
  - **Detail:** [ADR-0008](adr/0008-handles-are-addressable-by-emoji-and-by-their-word-alias.md) decision 3, [workstream](workstreams/3moji-mvp.md) Open questions.

- [ ] **Are 🎉🎉🎉, 🎫🎫🎫 and 🍕🍕🍕 the right Handles to keep for the platform?**
  - **What:** These three were reserved for 3moji itself while the Reserved Handle list was built, but they were never confirmed as a product decision. 🧊🧊🧊 is deliberately not reserved.
  - **Why it matters:** a platform Handle someone else has claimed can't be taken back.
  - **Options:** confirm them, swap some, or add more.
  - **Recommendation:** none recorded.
  - **Blocks:** nothing technical, but it must be settled before claims open.
  - **Detail:** [#52](https://github.com/joshstothard/3moji/issues/52), [workstream](workstreams/3moji-mvp.md) Open questions.

- [ ] **What a word address shows when it matches several unclaimed Handles**
  - **What:** `apple.apple.apple` can mean several Handles. If none is claimed, there's no single Handle to offer a claim for, and the current ADR doesn't say what to show.
  - **Why it matters:** visitors will type these addresses, and today the behaviour is an unrecorded deviation.
  - **Options:**
    1. A listing of the unclaimed candidates, each with a claim button.
    2. Offer the claim for the canonical candidate and mention the others.
    3. An honest "this could mean several Handles" page, which in practice becomes option 1.
  - **Recommendation:** the issue leans to option 1. It needs a new ADR (run `/adr`), because ADR-0008 can't be edited.
  - **Blocks:** one of Phase 4's acceptance criteria, which stays unticked until then.
  - **Detail:** [#121](https://github.com/joshstothard/3moji/issues/121).

- [ ] **Accept that a failed email no longer tells the person it failed**
  - **What:** Since [#216](https://github.com/joshstothard/3moji/issues/216), reset links, verification links and "you already have an account" notices are sent after the page has answered. If the email provider fails, the person still sees "a link is on its way", and the failure shows up only in the logs, as `auth_email_send_failed`, `claim_collision_email_failed` or `claim_verification_email_failed`.
  - **Why it matters:** before, a provider outage showed "something went wrong", but only for registered addresses, which told anyone who asked that the address had an account. Now nobody is told, including the real owner, who waits for an email that never comes.
  - **Options:** accept it and read the logs when someone reports a missing email; or alert on those three events once error tracking exists.
  - **Recommendation:** accept it, and alert on those three events when Phase 8's error tracking lands. Every one of those emails can be asked for again from the page the person is already on.
  - **Blocks:** nothing.
  - **Detail:** [Authentication](architecture/auth.md#what-an-operator-sees-when-a-send-fails).

- [ ] **Review: how axe checks the open account menu ([#225](https://github.com/joshstothard/3moji/pull/225))**
  - **What:** The orchestrator took this call overnight. When an open dropdown covers page text, axe checks only the open menu panel, and the whole page is still checked with the menu closed. It uses a new optional `include` on `checkPage` in `apps/web/e2e/support/axe.ts`, and every other caller is unchanged.
  - **Why it matters:** on Mobile Chrome the four-row account menu covers the Profile's own text, so axe can't judge that text's contrast while the menu is open. The scoped check still fails on violations and on anything axe can't decide.
  - **Options:** confirm it, or overrule it and change the menu's mobile layout so it covers no page text.
  - **Recommendation:** confirm it. It was observed failing on a deliberate contrast break and passing once the break was reverted.
  - **Blocks:** nothing.
  - **Detail:** PR [#225](https://github.com/joshstothard/3moji/pull/225) follow-up comments, [workstream](workstreams/3moji-mvp.md) Decision log, 2026-09-14.

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
