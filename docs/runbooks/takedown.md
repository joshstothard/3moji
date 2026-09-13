# Takedown

What to do when somebody reports a Profile or a Handle ([#197](https://github.com/joshstothard/3moji/issues/197)).

**Reporting is not moderation.** 3moji does not inspect Profiles; the MVP's non-goal "moderation beyond the URL scheme check" stands. This runbook is what happens _after_ somebody tells us about one.

## Contents

1. [How a report arrives](#1-how-a-report-arrives)
2. [Triage](#2-triage)
3. [Act](#3-act): take a Profile down, or release the Handle, and optionally reserve it
4. [Record](#4-record)
5. [Reply](#5-reply)
6. [Online Safety Act: does it apply?](#6-online-safety-act-does-it-apply) — an assessment for the owner to confirm

## 1. How a report arrives

Every claimed Handle's page (a Profile, and an unedited claimed Handle) carries **Report this page**: a `mailto:` link to the address in `REPORT_CONTACT_EMAIL`. The subject is filled in as:

```
Report a 3moji page: /%F0%9F%A7%8A%F0%9F%A7%8A%F0%9F%A7%8A
```

The path is the Handle's **canonical emoji path**, percent-encoded, whichever address the reporter was looking at — the word alias and the emoji URL of one Handle produce the same subject. The reporter can edit it, so treat it as a claim to check, not a fact.

The footer on every page also carries **Report a page**, to the same mailbox ([#198](https://github.com/joshstothard/3moji/issues/198)). It cannot know the page, so its subject is only `Report a 3moji page` and the body asks for the page's web address. A report with that subject and no address in it has to be answered with a request for one.

- **No link on the page?** `REPORT_CONTACT_EMAIL` is unset or refused. It must be one plain address with nothing else in it — no display name, no second address, no spaces or line breaks (`apps/web/.env.example`). Choosing the mailbox is an owner action (`docs/owner-actions.md`).
- **Reports by other routes** (a direct email, a message to the owner, a note from a registrar or a blocklist) go through the same steps.
- **Target:** acknowledge within 2 working days, and act on anything in the "act now" row of the triage table the same day it is read. These are starting values for the owner to confirm, not a commitment that has been published anywhere.

## 2. Triage

**Do not open the reported page's Links in your normal browser session.** A report about phishing or malware is a report about a hostile URL. Read the Profile from the database (step 2a), and if you must see a destination, use a URL scanning service or an isolated browser profile.

### 2a. Find the Handle

Decode the path from the subject into the canonical key the database stores:

```bash
node -e 'console.log(decodeURIComponent(process.argv[1]))' '%F0%9F%A7%8A%F0%9F%A7%8A%F0%9F%A7%8A'
```

Then read what is published, with the key bound as a `psql` variable rather than pasted into the SQL:

```sql
\set key '🧊🧊🧊'

SELECT h.key, h.user_id, h.claimed_at, u.email
FROM handle h
JOIN "user" u ON u.id = h.user_id
WHERE h.key = :'key';

SELECT display_name, bio, updated_at FROM profile WHERE user_id = (SELECT user_id FROM handle WHERE key = :'key');

SELECT position, title, url FROM link WHERE user_id = (SELECT user_id FROM handle WHERE key = :'key') ORDER BY position;
```

No row in `handle` means the Handle is not claimed (or was already released): there is nothing to take down. Reply saying so (step 5).

The owner's email address is personal data. Read it only when you are going to contact the owner, and never copy it into a GitHub issue, a commit or a PR — this repository is public (`AGENTS.md` § This Repository Is Public).

### 2b. Decide

| What the report shows                                                                                                          | Action                                                                                                                              |
| ------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| **Act now.** Child sexual abuse material, terrorism content, a credible threat to somebody, or a live phishing or malware Link | Release the Handle (3b) the same day, reserve it (3c), and report onward (below). Do not wait to hear from the owner.               |
| Impersonation of a real person or organisation, fraud, harassment of a named person, or other likely illegal content           | Take the Profile down (3a) while you look, then decide within 2 working days whether to release it.                                 |
| An offensive or misleading **Handle** (the emoji themselves), with nothing illegal on the Profile                              | Nothing is taken down by default. Add the Handle to the Reserved list for future Claims (3c) if it should never be claimable again. |
| Content the reporter dislikes but which is lawful and not deceptive                                                            | No action. Reply (step 5).                                                                                                          |
| Not a 3moji page, or not enough information to find one                                                                        | Reply asking for the full address.                                                                                                  |

**Report onward** where the law or the harm calls for it, in addition to acting here:

- Suspected child sexual abuse imagery: the [Internet Watch Foundation](https://www.iwf.org.uk/en/uk-report/). Never download, screenshot or forward the material itself — record only the Handle, the Link URL and the time.
- A scam or phishing site that a Link points to: the NCSC's [Report a suspicious website](https://www.ncsc.gov.uk/section/about-this-website/report-scam-website). A reporter who has lost money should report to [Report Fraud](https://www.reportfraud.police.uk/) themselves (England, Wales and Northern Ireland).
- An immediate risk to somebody's safety: the police.

## 3. Act

There is **no admin interface yet**. Every step below is run against the production database by the owner, with a direct connection string that is never pasted into a terminal that logs, a GitHub issue or a chat. Open a transaction for every write, and check the row counts before `COMMIT`.

### 3a. Take a Profile down, keeping the Account

For a first or uncertain case: the Profile stops showing a name, a bio or any Link, the Handle still resolves, and the owner keeps their Account.

```sql
\set key '🧊🧊🧊'
BEGIN;
DELETE FROM link WHERE user_id = (SELECT user_id FROM handle WHERE key = :'key');
UPDATE profile SET display_name = NULL, bio = NULL, updated_at = now()
WHERE user_id = (SELECT user_id FROM handle WHERE key = :'key');
-- Sign the owner out everywhere, so an open edit form cannot put it straight back.
DELETE FROM session WHERE user_id = (SELECT user_id FROM handle WHERE key = :'key');
COMMIT;
```

**This is not durable.** The owner can sign in and publish the same content again. If they do, release the Handle (3b).

### 3b. Release the Handle (delete the Account)

Release is **account deletion**: the Account, its sessions, its Profile and its Links all go, and the Handle returns to the pool immediately ([ADR-0004](../adr/0004-the-handle-model.md) decision 5, [ADR-0009](../adr/0009-release-leaves-a-tombstone-and-the-cooldown-is-dropped-for-the-mvp.md)). It cannot be undone.

The domain path is `releaseHandle` in `packages/core/src/handle/release-handle.ts`, which takes the owner's user id. **An owner can now do this themselves**: the account page at `/account`, reached from the signed-in indicator, deletes their own Account through `releaseHandle` ([#195](https://github.com/joshstothard/3moji/issues/195)), so an owner who asks for their Account to be deleted can be pointed there. It only ever deletes the signed-in person's own Account, so **a takedown still goes through the SQL below**, and there is still no admin interface or command. The SQL must do what `releaseHandle` does, **in the same order and in one transaction**:

1. Read the Handle's key **before** deleting anything — `handle.user_id` cascades on `user`, so the key is gone the moment the Account is.
2. Write the `released_handle` tombstone (the key and the time).
3. Delete the `user` row. The cascade removes the `handle`, `session`, `account`, `profile` and `link` rows.

```sql
\set key '🧊🧊🧊'
BEGIN;
SELECT user_id FROM handle WHERE key = :'key' \gset
-- \gset stores the id as :user_id, and fails unless exactly one row came back
INSERT INTO released_handle (id, key, released_at)
SELECT gen_random_uuid()::text, key, now() FROM handle WHERE user_id = :'user_id';   -- expect INSERT 0 1
DELETE FROM "user" WHERE id = :'user_id';                -- expect DELETE 1
SELECT count(*) FROM handle WHERE key = :'key';          -- expect 0
COMMIT;
```

If any count is not what the comment expects, `ROLLBACK;` and stop.

### 3c. Keep the Handle from being claimed again

Released Handles are claimable at once, by anybody, including the person who just lost one. To stop that, add the Handle to the Reserved list in `packages/core/src/handle/reserved-handles.ts` through an ordinary pull request (`docs/architecture/data-model.md` § Reserved Handles names reports as a source of entries).

- **Additions apply to future Claims only.** Reserving a Handle does not take it from somebody who already owns it — that is 3b.
- **The repository is public.** The commit message, the PR and any comment in the list say only that the Handle is reserved. They name no reporter, no owner, no reason and no link to the report.

### 3d. Check it took

- Load the Handle's page in a private window. A taken-down Profile shows no name, bio or Links; a released Handle shows the builder offering it to claim (or "This Handle is reserved." once 3c has shipped).
- **Caches.** The Profile's Open Graph image is served with `Cache-Control: public, max-age=300, s-maxage=300`, so an unfurled card can show the old name for up to five minutes, and sites that have already unfurled the link keep their copy. Whether Vercel's CDN holds the Profile page itself after a change made in SQL — which bypasses the `revalidatePath` an edit through the app triggers — is **not verified yet**; it needs a deployed environment ([#32](https://github.com/joshstothard/3moji/issues/32)). If the old page is still served, redeploy or purge the cache from the Vercel dashboard, and update this step with what worked.

## 4. Record

Keep a record of every report, **outside this repository** — a private spreadsheet or document the owner controls. It is evidence of what was done and when, and it contains personal data, so it never goes in a GitHub issue, a commit or a PR.

For each report, record:

| Field          | What goes in it                                                                                                          |
| -------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Received       | Date and time the email arrived                                                                                          |
| Reporter       | Their email address, and whether they asked not to be named to the owner                                                 |
| Handle         | The canonical key and path from step 2a                                                                                  |
| Category       | Which row of the triage table it fell in                                                                                 |
| Evidence       | What was on the Profile when checked: the SQL output from 2a, the Link URLs, scan results. No copies of illegal material |
| Decision       | Take down, release, reserve, no action — and why, in a sentence                                                          |
| Action taken   | What was run, when, and by whom; the `released_handle` row's `released_at` for a release                                 |
| Onward reports | Where it was reported (IWF, NCSC, police), when, and any reference number                                                |
| Replies        | When the reporter and, where contacted, the owner were told, and what they were told                                     |

How long these records are kept is an owner decision, and belongs in the privacy notice ([#196](https://github.com/joshstothard/3moji/issues/196)).

## 5. Reply

Reply from the report mailbox. Keep it short and factual; never promise a timescale you are not sure to meet, and never tell a reporter anything about the owner's Account beyond what the public page already showed.

**To the reporter, once decided:**

> Thanks for reporting 3moji.me/[path]. We have looked at it and [taken the page down / removed the Handle / decided not to remove it, because …]. If you think we have got this wrong, reply to this email and tell us why.

That last sentence is the complaints route: a reply is reviewed again, from step 2b, preferably by somebody who did not make the first decision (while the service has one operator, re-read it the next day).

**To the owner, when their Profile was taken down or their Handle released** (not for the "act now" categories where telling them could tip somebody off or put somebody at risk):

> Your 3moji page at 3moji.me/[path] has been [taken down / removed, and your account deleted] because it [short reason, naming the content, not the reporter]. If you think this is a mistake, reply to this email and tell us why.

Never name the reporter to the owner.

## 6. Online Safety Act: does it apply?

> **Assessment for the owner to confirm. This is not legal advice**, and it was drafted by a coding agent from public sources on 2026-09-13. Confirm it with [Ofcom's Regulation Checker](https://www.ofcom.org.uk/online-safety/illegal-and-harmful-content/check) before 3moji is announced, and take legal advice if the answer is uncertain.

### Conclusion: likely in scope, as a small user-to-user service

**Why it is likely a user-to-user service.** The Online Safety Act 2023 defines one as an internet service through which content "generated directly on the service by a user of the service, or uploaded to or shared on the service by a user of the service, may be encountered by another user" ([s.3(1)](https://www.legislation.gov.uk/ukpga/2023/50/section/3)). A Profile is exactly that: an owner writes a display name, a bio and Links, and anybody who visits the Handle reads them. The capability is enough — the proportion of user content does not matter ([s.3(2)](https://www.legislation.gov.uk/ukpga/2023/50/section/3)). The Handle itself, three emoji chosen by the user, is arguably user-generated too.

**Why no exemption appears to fit.** Schedule 1 exempts email-only, SMS/MMS-only and one-to-one live voice services, internal business services, public bodies and education providers, none of which 3moji is ([Schedule 1, Part 1](https://www.legislation.gov.uk/ukpga/2023/50/schedule/1)). The closest is the **limited functionality** exemption (paragraph 4), and it covers a service whose users can only post comments or reviews on **the provider's own content**, share them, and react with likes, emoji, votes or ratings. A Profile is the user's own content, not a comment on ours, so paragraph 4 does not reach it.

**Why it likely has links with the UK.** A service is in scope if it has a significant number of UK users, or the UK is one of its target markets ([s.4(5)](https://www.legislation.gov.uk/ukpga/2023/50/section/4)), or it can be used in the UK and there is a material risk of significant harm to people here ([s.4(6)](https://www.legislation.gov.uk/ukpga/2023/50/section/4)). 3moji is run from the UK, in English, on a domain aimed at everyone; the UK is at least one of its target markets.

**What is uncertain.** Whether a site this small, with no feed, messaging or search between users, is treated differently in practice. Ofcom says it will take "a reasonable approach to enforcement with smaller services that present low risk" ([Helping small services navigate the Online Safety Act](https://www.ofcom.org.uk/online-safety/illegal-and-harmful-content/helping-small-services-navigate-the-online-safety-act), updated 17 December 2025) — which is about enforcement, not scope. The Regulation Checker is the step that settles scope.

### What being in scope would ask of 3moji

From Ofcom's guidance, for a small, low-risk user-to-user service:

| Duty                                                                                                                   | Source                                                                                                                                                                                                              | Where 3moji stands                                                                                                                                     |
| ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| An **illegal content risk assessment**, within three months of launching, kept up to date and reviewed at least yearly | [Illegal content duties under the Online Safety Act](https://www.ofcom.org.uk/online-safety/illegal-and-harmful-content/illegal-content-duties-under-the-online-safety-act) (updated 25 June 2026)                  | **Not done.** Owner action.                                                                                                                            |
| A **children's access assessment**, within three months of becoming available, recorded, and repeated within 12 months | [Quick guide to children's access assessments](https://www.ofcom.org.uk/online-safety/illegal-and-harmful-content/quick-guide-to-childrens-access-assessments) (updated 29 June 2026)                               | **Not done.** 3moji has no age assurance, so children can access it; the question is whether a significant number do or would. Owner action.           |
| Let users and affected people **easily report illegal content**                                                        | [s.20](https://www.legislation.gov.uk/ukpga/2023/50/section/20); the small-services page asks for "a complaints tool that allows users to report illegal or harmful material"                                       | **Partly.** The report link and this runbook. A mailto needs a mail client; a web form may be expected later.                                          |
| A **complaints procedure** that is easy to access, easy to use and transparent, described in the terms                 | [s.21](https://www.legislation.gov.uk/ukpga/2023/50/section/21)                                                                                                                                                     | **Partly.** Replying to the report email is the route (step 5); the terms must describe it ([#196](https://github.com/joshstothard/3moji/issues/196)). |
| **Take illegal content down swiftly** once aware of it                                                                 | Illegal content duties page, above                                                                                                                                                                                  | This runbook, steps 2 and 3.                                                                                                                           |
| Easy-to-find, understandable **terms of service**                                                                      | Small-services page, above                                                                                                                                                                                          | In progress ([#196](https://github.com/joshstothard/3moji/issues/196)).                                                                                |
| **A named individual responsible for compliance**, whom Ofcom can contact                                              | Small-services page, above                                                                                                                                                                                          | **Not done.** Owner action.                                                                                                                            |
| **Written records** of the assessments                                                                                 | [Record-Keeping and Review Guidance](https://www.ofcom.org.uk/siteassets/resources/documents/online-safety/information-for-industry/illegal-harms/record-keeping-and-review-guidance.pdf) (published 24 April 2025) | **Not done.** Keep them with the report records (step 4), outside this repository.                                                                     |

Ofcom's [compliance guide for services](https://www.ofcom.org.uk/online-safety/illegal-and-harmful-content/guide-for-services) walks through these in order: check the Act applies, do the illegal content risk assessment, do the children's access assessment, then a children's risk assessment if the first says children are likely to use the service.

**Sources checked on 2026-09-13.** Ofcom revises these pages; the dates in brackets are each page's own "last updated" date as read that day. Re-check them before relying on this section.
