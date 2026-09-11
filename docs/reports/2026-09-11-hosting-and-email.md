# Free-tier Postgres and transactional email for 3moji on Vercel Hobby

**Type:** Research
**Date:** 2026-09-11
**Author:** Josh Stothard (with Claude)
**Status:** Draft
**Related:** #11, #8 (3moji MVP map)

## Question

Which free-tier Postgres and which free transactional email provider fit a Next.js-only app on Vercel Hobby, and how do Drizzle migrations run against the chosen database across local, preview, and production?

## Summary

- **Postgres: Neon via the Vercel Marketplace (Vercel-managed integration).** "Vercel Postgres" no longer exists; Vercel moved every store to Neon in December 2024 and now points new projects at the Marketplace [1]. Neon's Free plan gives 0.5 GB storage and 100 CU-hours per project per month, scales to zero after 5 minutes (cannot be disabled on Free) and resumes "within a few hundred milliseconds" [2][3][4]. The integration injects `DATABASE_URL` (pooled) and `DATABASE_URL_UNPOOLED` and can create a `preview/<git-branch>` database branch per preview deployment [5]. Drizzle ships a first-party `neon-http` driver and a matching migrator [6][7].
- **Supabase as plain Postgres is the runner-up, not the pick.** Its Free plan is 500 MB and pauses the whole project after 7 days of low activity, which on a hobby app means a manual un-pause from the dashboard, not a sub-second cold start [8][9]. Branching is a paid add-on at $0.01344 per branch-hour on Pro and above [8].
- **Email: Resend.** Free plan is 3,000 emails/month with a 100/day cap, 3 domains, no branding [10]. Brevo's 300/day is bigger, but every Free-plan email carries a "Sent with Brevo" sticker, which is the wrong look for verification and password-reset mail [11]. Resend's one restriction that bites is that the test domain only delivers to the account owner's address, so `3moji.me` must be verified before any real user can sign up [12].
- **Vercel Hobby forbids commercial use.** Terms: "You shall only use the Services under a Hobby plan for your personal or non-commercial use" [13]. Vercel counts ads, affiliate-first sites, and any payment request as commercial; donations are not [14]. The Hobby limits that matter for launch: 100 GB Fast Data Transfer, 1M function invocations, 4 CPU-hours, 100 deployments/day, 1 hour of runtime logs [14][15].
- **Migrations:** commit `drizzle-kit generate` output to `drizzle/`, run `drizzle-kit migrate` against `DATABASE_URL_UNPOOLED` as the first half of the Vercel build command so each preview branch and production get their migration in the same deploy that ships the code. Neon's own guide says to use the direct (non-pooled) connection for migrations [16].

## Background

3moji is a Next.js-only app deployed to Vercel on the Hobby plan, using Drizzle ORM on Postgres, with email-and-password auth that sends verification and password-reset emails. The domain `3moji.me` is registered with DNS at GoDaddy. It is a solo hobby project on free tiers for the MVP. This report is a sub-question of the MVP map (#8) and unblocks #17 and #19.

Two repo constraints shape the answer:

- Absolute Rule 4 (AGENTS.md): every schema change ships with a migration file and there is no dashboard DDL. That rules out `drizzle-kit push` as the production path and makes "where do migrations run" a first-class question.
- Free tiers only, so the comparison is on free-plan limits as published on 2026-09-11. These numbers change; each is cited to the page and date read.

`docs/architecture/` does not exist yet, so there is no current-state doc to link.

## Findings

### 1. Vercel's own Postgres is gone; the Marketplace is the only path

Vercel's Postgres docs page (last updated 2026-01-13) says: "Vercel Postgres is no longer available. If you had an existing Vercel Postgres database, we automatically moved it to Neon in December 2024. For new projects, install a Postgres integration from the Marketplace." The Marketplace path provisions the database and has "credentials and environment variables injected into your Vercel project" [1]. Neon's transition guide records that former Vercel Postgres Hobby users landed on the Neon Free plan [17]. So the third candidate collapses into the first: "Vercel's Postgres" today is Neon installed through the Marketplace, billed through Vercel [18].

Native Marketplace integrations can be installed from the dashboard or `vercel integration add neon`, and the connected project gets env vars named by the provider (for example `PGHOST`, `PGPASSWORD`), optionally prefixed [19].

### 2. Neon Free plan (read 2026-09-11)

From Neon's pricing and plans pages [2][3]:

| Item                      | Neon Free                                                             |
| ------------------------- | --------------------------------------------------------------------- |
| Storage                   | 0.5 GB per project                                                    |
| Compute                   | 100 CU-hours per project per month; compute suspends when exhausted   |
| Autoscaling               | Up to 2 CU (8 GB RAM)                                                 |
| Scale to zero             | After 5 min idle; "cannot disable" on Free [3][4]                     |
| Cold start                | "reactivates automatically within a few hundred milliseconds" [4]     |
| Projects / branches       | 100 projects per org; 10 branches per project                         |
| Data transfer             | 5 GB per project per month                                            |
| Restore / PITR window     | 6 hours, up to 1 GB-month                                             |
| Credit card               | Not required; the plan is permanent, not a trial                      |

CU-hours are "compute size x hours running" and "Computes that are suspended do not accrue CU-hours" [20]. At the 0.25 CU floor, 100 CU-hours is ~400 running hours a month, i.e. more than a hobby app that idles between visits will use.

**Connections and pooling.** Neon sizes `max_connections` by compute (104 at 0.25 CU, 419 at 1 CU, 839 at 2 CU; 7 reserved for Neon). Appending `-pooler` to the endpoint host routes through PgBouncer, which accepts up to 10,000 client connections and pools 90% of `max_connections` per user/database. Neon's guidance for serverless: use the pooled string, because "each invocation may open a connection" [21].

**Vercel integration and preview branches.** The Vercel-managed integration injects `DATABASE_URL` (pooled), `DATABASE_URL_UNPOOLED` (direct), `PGHOST`, `PGHOST_UNPOOLED`, `PGUSER`, `PGDATABASE`, `PGPASSWORD`, and legacy `POSTGRES_*` names. With preview branching enabled (toggle "Required -> Preview" while connecting the project, with "Resource must be active before deployment" on), a push to a feature branch makes Vercel webhook Neon, which creates the branch `preview/<git-branch>` and injects that branch's connection variables into the preview deployment at deploy time; those values are not visible in the Vercel env var settings [5]. Neon's guide explicitly suggests running migrations in the build command so "schema changes in your commits are applied to each preview deployment's database branch" (its example is Prisma; the Drizzle equivalent is in Finding 6) [5]. Preview branches are deleted when the Vercel deployment is removed, which follows Vercel's retention policy rather than the Git branch, so they can linger; the Neon-managed (non-Marketplace) integration instead cleans up on Git branch deletion [22]. Both integrations support preview branching [22]. Branches count against the 10-per-project Free limit, so stale preview branches need periodic cleanup (inference from the limit; Neon does not state it directly).

**Drizzle drivers.** Drizzle documents three ways to connect to Neon: `drizzle-orm/neon-http` over HTTP for "single, non-interactive transactions"; `drizzle-orm/neon-serverless` over WebSockets when "session or interactive transaction support" is needed (Node needs the `ws` and `bufferutil` packages); or `node-postgres` / `postgres-js` over TCP for serverful hosts [6]. Neon's driver docs confirm the HTTP `neon()` function supports only non-interactive batched transactions via `transaction()`, not interactive ones [23]. `drizzle-orm/neon-http/migrator` exports `migrate(db: NeonHttpDatabase, config)` [7], so migrations can be run programmatically over HTTP as well as via `drizzle-kit migrate`.

### 3. Supabase as Postgres only (read 2026-09-11)

From Supabase's pricing page and platform docs [8][9][24][25]:

| Item                      | Supabase Free                                                              |
| ------------------------- | -------------------------------------------------------------------------- |
| Storage                   | 500 MB database                                                            |
| Compute                   | Nano: shared CPU, up to 0.5 GB RAM; "subject to change" [24]               |
| Projects                  | 2 active free projects across orgs you own/admin [25]                      |
| Idle behaviour            | Project paused after 7 days of low activity [8][9]                         |
| Cold start                | None in the Neon sense; a paused project needs a manual resume from the dashboard, with a 1-year restore window [9] |
| Connections               | Nano: 60 direct, 200 pooler clients [24]                                   |
| Egress                    | 5 GB                                                                       |
| Branching                 | Add-on, $0.01344 per branch-hour, Pro/Team/Enterprise only [8]              |
| Backups                   | No automatic backups or PITR on Free [8]                                   |

**Connections from serverless.** Supabase offers direct (`db.<ref>.supabase.co:5432`, IPv6 only on Free without the IPv4 add-on), Supavisor session mode (port 5432, IPv4), and transaction mode (port 6543). Serverless should use transaction mode, which "does not support prepared statements" [26]. Drizzle's Supabase guide uses `postgres-js` with `postgres(url, { prepare: false })` for that reason [27]. There is no Neon-style HTTP driver.

**Vercel integration.** The Supabase Marketplace integration is billed through Vercel at the same prices as direct, and syncs `POSTGRES_URL`, `POSTGRES_PRISMA_URL`, `POSTGRES_URL_NON_POOLING`, `POSTGRES_USER/HOST/PASSWORD/DATABASE`, plus `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_JWT_SECRET` and `NEXT_PUBLIC_*` variants [28][29]. Preview-branch env var sync exists but rides on the paid branching add-on [8][30]. Whether the Free plan is selectable through the Marketplace: the listing says "Plans starting at $0" [29] (not verified by installing).

**What bites.** A hobby launch will have quiet weeks. On Neon that costs a few hundred milliseconds on the first request; on Supabase it means the database is paused until the owner logs in and resumes it, and users see errors until then. That is the decisive difference for an app with no one on call.

### 4. Vercel Hobby: what it forbids and what limits a launch (read 2026-09-11)

- **Non-commercial only.** Terms of Service: "You shall only use the Services under a Hobby plan for your personal or non-commercial use" [13]. Fair Use Guidelines: "Hobby teams are restricted to non-commercial personal use only." Commercial use is "any Deployment that is used for the purpose of financial gain of anyone involved in any part of the production," including payment requests, "advertising the sale of a product or service," being paid to build or host the site, affiliate linking as the primary purpose, or "the inclusion of advertisements, including ... Google AdSense." "Asking for Donations does not fall under commercial usage." [14]
- **Typical monthly usage on Hobby** (fair-use table): Fast Data Transfer up to 100 GB, Fast Origin Transfer up to 10 GB, Active CPU up to 4 CPU-hours, Provisioned Memory up to 360 GB-hours, Function Invocations up to 1M, Image transformations 5K, Edge Requests up to 1M [14][15].
- **Hobby plan page:** 200 projects, 300 s max function duration, 2 build vCPUs, 50 domains per project, 100 deployments per day, 1 hour of runtime logs, Web Analytics 50K events, no email support. There are no billing cycles; exceed a limit and "you will have to wait until 30 days have passed before you can use the feature again" [15].
- **Which of these matter for 3moji:** the 1-hour runtime log window (debugging a production incident means looking within the hour or adding an external sink), the 30-day lockout on overage (no pay-as-you-go safety valve on Hobby), and the commercial clause (no ads, no "buy me a coffee" beyond donation language, no paid tier). The 4 CPU-hours is 240 CPU-minutes of actual function CPU per month; a mostly-static emoji app is unlikely to approach it, but it is the tightest number on the list.

### 5. Transactional email (read 2026-09-11)

| Item                          | Resend Free                                                        | Brevo Free                                                         |
| ----------------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------ |
| Monthly volume                | 3,000 emails/month [10]                                            | No monthly cap stated; 300/day = up to ~9,000/month [11]           |
| Daily volume                  | 100/day [10]                                                       | 300/day; unused do not roll over. Transactional overflow: up to 1,000 held in a retry queue, beyond that not delivered [11] |
| Domains                       | 3 [10]                                                             | Not stated on the Free FAQ (unverified)                            |
| Branding                      | None stated                                                        | "Emails sent from the Free plan always include the Sent with Brevo sticker"; removal is a paid add-on (GBP 7.20/month on Starter) [11][31] |
| Data retention                | 30 days [10]                                                       | Not checked                                                        |
| Free-tier restriction         | Test domain `resend.dev` "can only send emails to the email address associated with your Resend account"; a verified domain is required to reach anyone else [12] | One user seat; basic stats only; 2,000 contacts in automations [11] |
| Node SDK                      | `resend` 6.28.0 (published 2026-09-11), TypeScript, `react:` prop renders React Email templates [32][33] | `@getbrevo/brevo` 6.0.3 (modified 2026-08-10), Fern-generated, typed; `brevo.transactionalEmails.sendTransacEmail(...)` [34] |
| Next.js docs                  | First-party App Router route-handler example [33]                  | Generic Node docs; no Next.js-specific guide found                 |
| First paid tier               | Pro $20/month for 50,000 emails [10]                               | Starter GBP 6/month for 5,000 emails/month [31]                     |

**Domain verification for `3moji.me` at GoDaddy.**

_Resend_ asks for three records under a sending subdomain, and recommends a subdomain over the root "to isolate your sending reputation" [35][36]. Resend's GoDaddy guide lists them with the Name to type (GoDaddy takes the host without the domain) [37]:

| Type | Name (GoDaddy)      | Value                                              | TTL |
| ---- | ------------------- | -------------------------------------------------- | --- |
| MX   | `send`              | `feedback-smtp.<region>.amazonses.com`, priority 10 | 600 |
| TXT  | `send`              | `v=spf1 include:amazonses.com ~all`                | 600 |
| TXT  | `resend._domainkey` | `p=<key from Resend dashboard>`                    | 600 |

Values must be copied from the Records tab for the domain (the region in the MX host is chosen at setup) [36][37]. DMARC is optional: "After your domain is verified, you can then implement DMARC" [36]. Resend also offers an "Auto Configure" button that uses Domain Connect to write the records into GoDaddy directly [37]. Verification "typically occurs within 15 minutes" but DNS can take up to 72 hours [36]. GoDaddy's own TXT-record guide confirms the Name is "the hostname or prefix of the record, without the domain name" and that most updates take effect within an hour, up to 48 [38].

If `3moji.me` is added as a subdomain sender such as `mail.3moji.me`, the Names become `send.mail` and `resend._domainkey.mail` (from Resend's "send.subdomain if you're using a subdomain" instruction [37]).

_Brevo_ authenticates the root domain with three or four records: a "Brevo code" TXT, a DKIM record ("1 TXT or 2 CNAME"), and a DMARC TXT. Its FAQ has a dedicated entry on whether SPF/MX are needed, and it has a GoDaddy dropdown with steps and an automatic mode that logs into the registrar for you; it will replace an existing DMARC record unless you go manual [39]. Exact host names were behind the collapsed provider dropdowns and are not reproduced here (unverified).

**Free-tier restrictions that bite.**

- Resend: until `3moji.me` is verified, nothing can be sent to a real user [12]. The 100/day cap is a hard ceiling on sign-ups plus resets per day; 3,000/month is 100/day for a month.
- Brevo: the sticker on every auth email, and the daily cap being shared with marketing campaigns (irrelevant here, but the retry queue silently drops mail past 1,300 in a day) [11].

### 6. Drizzle migration workflow on Neon

Drizzle's migrations page lists six strategies; the two that satisfy Absolute Rule 4 (migration file committed, no dashboard DDL) are "generate and migrate via CLI" and "generate and apply at runtime with `migrate()`" [40]. `drizzle-kit push` is recommended by Drizzle for prototyping but produces no SQL file, so it is out for anything past a local scratch database [40].

`drizzle-kit migrate` reads the `.sql` files in the migrations folder, compares against the `__drizzle_migrations` table in the `drizzle` schema, and applies the unapplied ones; it needs `dialect`, `dbCredentials.url`, and the folder, from `drizzle.config.ts` or flags, and supports alternate configs via `--config` [41]. Neon's Drizzle guide: "using a pooled connection string for migrations can lead to errors ... we recommend using a direct (non-pooled) connection when performing migrations" [16].

Proposed workflow (a proposal for the ADR, not yet exercised in this repo):

| Environment | Database                                              | Who runs migrations                                                                  |
| ----------- | ----------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Local       | Neon dev branch per developer, or local Postgres in Docker | Developer: `drizzle-kit generate` after editing `schema.ts`, then `drizzle-kit migrate`; commit `drizzle/*.sql` and `drizzle/meta/` with the schema change |
| Preview     | Neon `preview/<git-branch>`, created by the integration [5] | Vercel build command: `drizzle-kit migrate && next build`, with `drizzle.config.ts` reading `DATABASE_URL_UNPOOLED` [5][16] |
| Production  | Neon main branch                                      | Same build command on the production deploy; the migration runs before `next build`, so a failing migration fails the deploy and the previous deployment stays live |

Notes on the choice of build step over a separate CI job:

- The preview branch's connection string is injected only into the deployment, not visible in Vercel settings and not available to GitHub Actions [5], so a CI job could not target it without extra Neon API plumbing. The build step is the only place that already has the right `DATABASE_URL_UNPOOLED` for every environment.
- `drizzle-kit migrate` is idempotent on an already-migrated branch, so redeploys are safe [41].
- The runtime `migrate()` from `drizzle-orm/neon-http/migrator` [7] is the fallback if the build container cannot reach Neon over TCP; it would run from a one-off script, not on every request.
- Running DDL from Vercel's build is dashboard-free and file-driven, which is what Rule 4 wants; the CI `verify.sh` gate should also run `drizzle-kit generate --check` (or equivalent) so a schema edit without a committed migration fails before merge (command not yet verified against drizzle-kit 0.31.10).

## Options

| Option                                  | Pros                                                                                                                                                     | Cons                                                                                                                           | Effort | Risk |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ------ | ---- |
| A. Neon via Vercel Marketplace          | Sub-second resume from idle; env vars and preview branches injected by Vercel; HTTP driver for serverless; billing on the Vercel account; 100 CU-hours of mostly-idle compute is ample | 0.5 GB storage; 10 branches per project so stale previews need cleanup; scale-to-zero cannot be turned off on Free            | L      | L    |
| B. Supabase as Postgres only            | Larger 500 MB limit on paper is similar; full Postgres; Marketplace integration exists                                                                   | Pauses after 7 idle days and needs manual resume; branching is paid; no HTTP driver; `prepare: false` needed on the pooler; brings an auth/API surface we will not use | M      | M    |
| C. Neon-managed integration (non-Marketplace) | Git-branch-based cleanup of preview branches [22]                                                                                                  | Separate Neon account and billing; Vercel does not manage the lifecycle; no advantage on Free                                  | L      | L    |
| D. Resend                               | Clean auth email, first-party Next.js/React Email path, 3 domains, simple DNS at GoDaddy with Auto Configure                                              | 100/day, 3,000/month; must verify domain before any real send                                                                  | L      | L    |
| E. Brevo                                | 300/day; retry queue; automatic registrar authentication                                                                                                 | "Sent with Brevo" sticker on every Free email; marketing-suite SDK; single seat                                                 | L      | M    |

## Recommendation

**Postgres: Option A, Neon through the Vercel Marketplace, connected with `drizzle-orm/neon-http` for request-time queries and `DATABASE_URL_UNPOOLED` for `drizzle-kit migrate` in the build command.** The deciding fact is idle behaviour: Neon comes back in a few hundred milliseconds [4], Supabase stays paused until someone logs in [9]. Preview branching on Free and env-var injection [5] remove the two chores that otherwise eat a solo developer's evenings. Confidence: high. What would change it: needing interactive transactions in request handlers (then switch to `neon-serverless` over WebSockets, still Neon), or outgrowing 0.5 GB (Neon Launch is pay-as-you-go [2]).

**Email: Option D, Resend, sending from a subdomain of `3moji.me` such as `mail.3moji.me`.** Auth mail with a third-party sticker is the wrong first impression, and Resend's daily cap of 100 is enough for an MVP where each sign-up is one verification email. Confidence: high. What would change it: sustained sign-ups above ~80/day, at which point Resend Pro ($20/month, 50,000) [10] is the next step rather than Brevo, because the sticker does not go away on Brevo Free.

**Hobby plan:** 3moji must stay free of ads, affiliate links, and any payment request; donation asks are allowed [14]. Watch the 4 CPU-hours and 1-hour log retention [15].

**Migrations:** commit `drizzle-kit generate` output; run `drizzle-kit migrate` as the first half of the Vercel build command against the unpooled URL in every environment; never `push` past local.

## Next steps

- **ADRs to write:** "Neon on Vercel Marketplace as the MVP database" and "Resend for transactional email" (the `adr` skill); the migration workflow belongs in the first ADR.
- **Issues to file:** verify `3moji.me` in Resend (records above, at GoDaddy); install the Neon integration with preview branching; add `drizzle.config.ts` reading `DATABASE_URL_UNPOOLED` and the build command; add a CI check that a schema change carries a migration file (the `capture` skill).
- **Unverified items to close during setup:** that the Free plan is selectable on the Marketplace install dialog (listing says "Plans starting at $0" [18]); the exact `drizzle-kit` flag for "schema and migrations out of sync" checks; Brevo's DKIM/DMARC host names (only needed if Brevo is revisited).

## Sources

All web sources read on 2026-09-11.

1. Vercel, "Postgres on Vercel" (last updated 2026-01-13): https://vercel.com/docs/postgres
2. Neon, "Pricing": https://neon.com/pricing
3. Neon, "Neon plans": https://neon.com/docs/introduction/plans
4. Neon, "Scale to zero": https://neon.com/docs/introduction/scale-to-zero
5. Neon, "Connecting with the Vercel-Managed Integration": https://neon.com/docs/guides/vercel-managed-integration
6. Drizzle ORM, "Drizzle <> Neon Postgres": https://orm.drizzle.team/docs/connect-neon
7. drizzle-orm package, `neon-http/migrator.d.ts` (via unpkg): https://unpkg.com/drizzle-orm/neon-http/migrator.d.ts
8. Supabase, "Pricing" (HTML and `pricing.md`): https://supabase.com/pricing
9. Supabase, "Project Pausing": https://supabase.com/docs/guides/platform/free-project-pausing
10. Resend, "Pricing": https://resend.com/pricing
11. Brevo Help, "FAQs - What are the limits of the Free plan?": https://help.brevo.com/hc/en-us/articles/208580669-FAQs-What-are-the-limits-of-the-Free-plan
12. Resend, "403 Error Using resend.dev Domain": https://resend.com/docs/knowledge-base/403-error-resend-dev-domain
13. Vercel, "Terms of Service": https://vercel.com/legal/terms
14. Vercel, "Fair Use Guidelines" (last updated 2026-07-29): https://vercel.com/docs/limits/fair-use-guidelines
15. Vercel, "Vercel Hobby Plan" (last updated 2026-08-31): https://vercel.com/docs/plans/hobby
16. Neon, "Schema migration with Neon Postgres and Drizzle ORM": https://neon.com/docs/guides/drizzle-migrations
17. Neon, "Vercel Postgres Transition Guide": https://neon.com/docs/guides/vercel-postgres-transition-guide (its "190 compute hours" figure predates the current plans page [3]; the plans page governs)
18. Vercel Marketplace, "Neon": https://vercel.com/marketplace/neon and https://vercel.com/marketplace/neon/neon
19. Vercel, "Add a Native Integration" (last updated 2026-05-05): https://vercel.com/docs/integrations/install-an-integration/product-integration
20. Neon, "Usage metrics": https://neon.com/docs/introduction/usage-metrics
21. Neon, "Connection pooling": https://neon.com/docs/connect/connection-pooling
22. Neon, "Integrating Neon with Vercel" (overview of the two integrations): https://neon.com/docs/guides/vercel-overview
23. Neon, "Neon serverless driver": https://neon.com/docs/serverless/serverless-driver
24. Supabase, "Compute and Disk": https://supabase.com/docs/guides/platform/compute-and-disk
25. Supabase, "About billing on Supabase": https://supabase.com/docs/guides/platform/billing-on-supabase
26. Supabase, "Connect to your database": https://supabase.com/docs/guides/database/connecting-to-postgres
27. Drizzle ORM, "Get started with Drizzle and Supabase": https://orm.drizzle.team/docs/get-started/supabase-new
28. Supabase, "Vercel Marketplace": https://supabase.com/docs/guides/integrations/vercel-marketplace
29. Vercel Marketplace, "Supabase": https://vercel.com/marketplace/supabase
30. Supabase, "Branching integrations": https://supabase.com/docs/guides/deployment/branching/integrations (via search snippet; page not read in full)
31. Brevo, "Pricing Plans" (GBP): https://www.brevo.com/pricing/
32. `npm view resend version time.modified` on 2026-09-11: `6.28.0`, modified 2026-09-11; GitHub https://github.com/resend/resend-node
33. Resend, "Send emails with Next.js": https://resend.com/docs/send-with-nextjs
34. `npm view @getbrevo/brevo version time.modified` on 2026-09-11: `6.0.3`, modified 2026-08-10; GitHub https://github.com/getbrevo/brevo-node
35. Resend, "Verified Domains": https://resend.com/docs/dashboard/domains/introduction
36. Resend, "Add and verify a domain": https://resend.com/docs/add-a-domain
37. Resend, "GoDaddy" DNS guide: https://resend.com/docs/knowledge-base/godaddy
38. GoDaddy Help, "Add a TXT record": https://www.godaddy.com/en-uk/help/add-a-txt-record-19232
39. Brevo Help, "Authenticate your domain with Brevo (Brevo code, DKIM, DMARC)": https://help.brevo.com/hc/en-us/articles/12163873383186
40. Drizzle ORM, "Migrations": https://orm.drizzle.team/docs/migrations
41. Drizzle ORM, "drizzle-kit migrate": https://orm.drizzle.team/docs/drizzle-kit-migrate
42. `npm view drizzle-orm version` / `drizzle-kit version` on 2026-09-11: `0.45.2` / `0.31.10`; `@neondatabase/serverless` `1.1.0`
