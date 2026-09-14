# Email not arriving

What to do when somebody does not get the email they were promised: a verification link after a Claim or a resend, a "you already have an account" notice, or a password reset link ([#207](https://github.com/joshstothard/3moji/issues/207)).

> **Written before the first deploy.** The log lines and error codes below are in the code today and can be relied on. The Resend dashboard steps are marked **(verify on deploy)**: they describe what to find, not screens that have been seen. Resend has no account yet ([#19](https://github.com/joshstothard/3moji/issues/19)), and nothing has been sent from production ([#32](https://github.com/joshstothard/3moji/issues/32)).

**Time matters.** A verification link expires in an hour, and a held Handle expires 24 hours after its Claim. A claimant who never gets a working link loses the Handle. See [auth.md](../architecture/auth.md) for why resending is the ordinary path.

## Contents

1. [Symptoms](#1-symptoms)
2. [Which email, and what sends it](#2-which-email-and-what-sends-it)
3. [Where to look](#3-where-to-look)
4. [Step-by-step checks](#4-step-by-step-checks)
5. [Recover](#5-recover)
6. [Record](#6-record)

## 1. Symptoms

- A claimant says the hold screen told them to check their email, and nothing came. See [§ 5a](#5a-a-claim-succeeded-but-its-email-did-not-arrive); the hold is running, so this one is urgent.
- Somebody asked for a resent link or a password reset link, was told it is on its way, and nothing came.
- A form answers "something went wrong", or the resend button or the password reset form answers with the generic failure state. **That is not a failed send.** Every email goes out after the answer, so a send cannot change it ([§ 2](#2-which-email-and-what-sends-it)). The action itself could not answer: go to [site down](site-down.md).
- Several people report it on the same day. Suspect the **Resend daily cap** first.
- The email arrived, but in the **Junk or Spam folder**. See [§ 5d](#5d-landing-in-junk). Nothing failed in the app.

**Do not ask a reporter to post their email address in a GitHub issue.** Handle the conversation privately. This repository is public (`AGENTS.md` § This Repository Is Public).

## 2. Which email, and what sends it

Every email goes through the Resend adapter, `packages/core/src/auth/adapters/resend-email-sender.ts`, and a failed send throws `ResendRequestRejected`. **Every email is sent after the response** ([#216](https://github.com/joshstothard/3moji/issues/216)), through Next.js's `after()` (`apps/web/src/lib/after-background-tasks.ts`). So a failed send never changes what the person is told: they see the ordinary success answer, and the request's boundary line records success. The failure is logged once, in the background, under an event of its own ([auth.md § What an operator sees when a send fails](../architecture/auth.md#what-an-operator-sees-when-a-send-fails)):

| Email                                          | Sent from                                                                                       | Boundary line (`console.log`)                    | Failure line (`console.error`)    |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------------- | ------------------------------------------------ | --------------------------------- |
| Verification link, on a fresh Claim            | Better Auth's sign-up inside the Claim, held until the commit, then sent as one background task | `claim.submit`, `outcome:"redirected"`           | `claim_verification_email_failed` |
| "You already have an account" (collision)      | `notifyExistingOwner`, after the Claim collided, through the background sender                  | `claim.submit`, `outcome:"redirected"`           | `claim_collision_email_failed`    |
| Verification link, resent from the hold screen | `resendVerification`, through the auth instance's background sender                             | `verification.resend`, `outcome:"redirected"`    | `auth_email_send_failed`          |
| Password reset link                            | `requestPasswordReset`, through the auth instance's background sender                           | `password-reset.request`, `outcome:"redirected"` | `auth_email_send_failed`          |
| Verification link via Better Auth's HTTP API   | `/api/auth/send-verification-email`, through the auth instance's background sender              | `auth.post`, a 2xx (`outcome:"ok"`)              | `auth_email_send_failed`          |

- **The failure line carries the `correlationId` of the request that scheduled the send**, read before the send was handed over, and the allow-listed `error` descriptor. No address, no token and no provider message.
- **It can appear after the request's own `api_boundary` line**, and after other requests' lines, because the send runs once the response has gone. Pair the two by `correlationId`, never by their order in the log.
- **`auth_email_send_failed` does not say which email failed.** Better Auth has one sender slot, so the reset link and the verification link share it. The boundary line with the same `correlationId` tells them apart: `password-reset.request`, or `verification.resend` / `auth.post`.
- **`claim_submit_failed`, `verification_resend_failed` and `password_reset_request_failed` are not email failures.** They still exist, but are logged only when the action itself could not answer: the database, a limiter that could not count, or a missing environment variable. The person sees the generic failure state. That is [site down](site-down.md), except a `missing` Resend variable, below.

**A successful send writes nothing about the email.** Every answer that could reveal whether an address is registered logs the same `redirected` outcome (non-enumeration, [system-overview.md § API boundary logging](../architecture/system-overview.md#api-boundary-logging)), and since #216 a failed send logs it too. So "no email failure line" means Resend accepted the email. It does not mean it was delivered.

## 3. Where to look

### The application's lines (Vercel runtime logs, **one hour only** on Hobby)

Capture them first, as in [site down § 2](site-down.md#2-capture-the-logs-now). Then search for the three email failure events above, `auth_email_send_failed`, `claim_collision_email_failed` and `claim_verification_email_failed`, and read `error`. Search a little past the time of the person's request, since the send ran after it:

| `error` shows                                                                  | Meaning                                                                                                                                                                             | Go to                                                 |
| ------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| `"name":"ResendRequestRejected"`, `"code":"DAILY_QUOTA_EXCEEDED"`              | The **100 emails a day** cap on Resend Free is used up                                                                                                                              | [5b](#5b-the-daily-cap-is-used-up)                    |
| `"code":"MONTHLY_QUOTA_EXCEEDED"`                                              | The 3,000 a month cap is used up                                                                                                                                                    | [5b](#5b-the-daily-cap-is-used-up)                    |
| `"code":"RATE_LIMIT_EXCEEDED"`, usually `"status":"429"`                       | Too many requests a second to Resend's API, not the daily cap                                                                                                                       | [5c](#5c-resend-refused-the-request)                  |
| `"code":"MISSING_API_KEY"`, `INVALID_API_KEY` or `RESTRICTED_API_KEY`          | The key is wrong, revoked, or lacks send permission                                                                                                                                 | [5c](#5c-resend-refused-the-request)                  |
| `"code":"INVALID_FROM_ADDRESS"` or `VALIDATION_ERROR`                          | `RESEND_FROM` is not on a verified domain, or the sending domain lost verification                                                                                                  | [5c](#5c-resend-refused-the-request)                  |
| `"code":"UNRECOGNISED"`, with a `status`                                       | A Resend error the allow-list does not name. The status still says what class it is                                                                                                 | [5c](#5c-resend-refused-the-request)                  |
| `"missing":"RESEND_API_KEY"` or `"missing":"RESEND_FROM"`                      | The variable is unset for Production. Services are built inside the request, so every request fails, under the action's own event such as `claim_submit_failed`, not an email event | [site down § 5b](site-down.md#5b-fix-the-environment) |
| A code such as `ECONNREFUSED` or `ETIMEDOUT`, name not `ResendRequestRejected` | Resend's API could not be reached                                                                                                                                                   | Resend's status page; retry later                     |
| `"name":"DatabaseQueryFailed"`                                                 | Not email: the action's own write failed, under its own event, and the person saw the generic failure state                                                                         | [site down](site-down.md)                             |

### Resend's dashboard **(verify on deploy)**

- **The email log**: was the email accepted, delivered, bounced, or marked as spam? Resend keeps it for 30 days (report § 5), so it outlives Vercel's hour. Search by recipient only in the dashboard, and never copy the address anywhere public.
- **Usage**: today's count against 100, and the month's against 3,000.
- **Domains**: the sending subdomain still shows as verified, with its SPF and DKIM records passing.
- **Resend's status page**, for an incident on their side.

### DNS

If the domain shows as unverified, check the SPF, DKIM and DMARC records for the sending subdomain at the DNS host. They are listed in the [hosting and email report](../reports/2026-09-11-hosting-and-email.md) § 5. A DMARC policy stricter than `p=none` makes a misconfiguration silently drop mail ([owner actions](../owner-actions.md)).

## 4. Step-by-step checks

1. **Capture the Vercel logs now**, before the hour passes.
2. **Is there an email failure line** for the time the person tried? It is written after that request's `api_boundary` line, so look a little later, and match by `correlationId` where the person quoted one. If yes, read `error` against the table in § 3 and go to its recovery step.
3. **If there is no failure line**, Resend accepted the email. Find it in Resend's email log **(verify on deploy)**:
   - _Delivered_: it reached the recipient's server. Ask them to check spam and any filters, and to search for the sending address. If it is in junk, go to [5d](#5d-landing-in-junk).
   - _Bounced_: the address is wrong or the mailbox refuses mail. The person must use a different address. For a Claim, that means a new Claim once the hold lapses.
   - _Complained / suppressed_: the recipient marked a previous email as spam, and Resend will not send to them again. That is resolved in Resend's suppression list, not in 3moji **(verify on deploy)**.
   - _Not in the log at all_: the request never reached Resend. Recheck step 2 against the right time window and timezone. The logs may already be gone. A deferred send also runs only within the function's maximum duration on Vercel, which is the platform's promise rather than a tested one ([auth.md](../architecture/auth.md#what-an-operator-sees-when-a-send-fails)).
4. **Did the person hit a limit instead?** A resend refused as `too-soon` or `too-many` logs `outcome:"rate-limited"` on `verification.resend`, not a failure. The limits are in [auth.md § Resend, and its limits](../architecture/auth.md#resend-and-its-limits): 3 links an hour per Account, at least 60 seconds apart. That is working as designed. Tell them when to try again.
5. **Is it everybody?** Many failure lines with the same code on one day is the cap or a configuration fault, not one person's mailbox.

## 5. Recover

### 5a. A Claim succeeded, but its email did not arrive

**The hold screen appeared as normal, the Handle is held, and no verification email came.** The verification email is held back until the Claim's transaction commits, then handed to the background as one task and sent after the response (`runWithTransactionalAuth`, `packages/core/src/adapters/transactional-auth.ts`). A failed send cannot change the answer. The claimant saw the hold screen, `claim.submit` logged `redirected`, and the only trace is a `claim_verification_email_failed` line under the Claim's `correlationId`.

The claimant is already on the right screen, so recovery is the ordinary path:

1. Tell the claimant the Handle **is** held for them, for 24 hours from their Claim.
2. Once the email cause is fixed (5b, 5c), they press **resend** on the hold screen and get a fresh link. If they have left it, they sign in with the email and password they used: Better Auth answers `EMAIL_NOT_VERIFIED`, and the app sends them back to their hold screen ([auth.md](../architecture/auth.md)).
3. Ask them to wait for the fix before resending. Each resend spends one of the Account's three links an hour, sign-up's link included, and a resend that fails for the same cause spends one for nothing.
4. If the cause cannot be fixed within the 24 hours, the hold lapses and the Handle is claimable again. Tell them so plainly. There is no tool to extend a hold.

A **collision notice** that fails is different. The Claim found the address already registered and created nothing, the claimant saw the same hold screen as a fresh Claim, and the existing owner gets no notice. It is logged as `claim_collision_email_failed`. Nothing needs repairing, and nothing depends on it.

The **other emails** fail the same quiet way, under `auth_email_send_failed`. A failed **resent link** has already made the previous link invalid, so the person resends again once the cause is fixed. A failed **reset link** changes nothing: they ask again from `/reset-password`, within its limit.

### 5b. The daily cap is used up

1. The cap resets daily **(verify on deploy)** for the reset time and timezone. Until then, **every** email fails: verification, resend and password reset alike.
2. Held Handles are at risk. Anybody who claimed today and got no email is in 5a's position. Once the cap resets, they need to resend.
3. Moving to Resend Pro is the owner's spending decision, already on [owner actions](../owner-actions.md) under "Launch-day email volume". Give the owner the day's count from Resend's usage page. The recommendation there is to upgrade together with Vercel Pro, before any public announcement.
4. Changing the plan needs no code change and no redeploy, as long as the API key stays the same **(verify on deploy)**.

### 5c. Resend refused the request

1. **API key** (`MISSING_API_KEY`, `INVALID_API_KEY`, `RESTRICTED_API_KEY`): create a new key with send permission in Resend, set it as `RESEND_API_KEY` for Production in Vercel, redeploy, and revoke the old one. Never paste the key anywhere but Vercel's variable field.
2. **Sender** (`INVALID_FROM_ADDRESS`, `VALIDATION_ERROR`): confirm `RESEND_FROM` is an address on the verified sending subdomain, and that the domain still shows as verified. Fix the DNS records if not, then wait for Resend to re-verify.
3. **Rate limit** (`RATE_LIMIT_EXCEEDED`): usually transient. If it persists, look for a burst of requests in the boundary lines. The app's own limits should keep a single client from causing one.
4. **Unrecognised or 5xx**: check Resend's status page. If Resend is healthy and the code is new, open an issue to add it to `RESEND_ERROR_CODES`.
5. After any fix, ask one affected person to resend. Their `verification.resend` line says `redirected` whether or not the email went out, so watch instead for **no** `auth_email_send_failed` line under its `correlationId` in the minutes after it.

### 5d. Landing in junk

The email was sent and delivered, and the recipient's provider filed it as junk. **No app log shows this**: Resend reports it as delivered. The first live verification email, on 2026-09-14, landed in Outlook's Junk folder with SPF, DKIM and DMARC all passing ([#240](https://github.com/joshstothard/3moji/issues/240)).

1. **Confirm it was delivered.** Find the email in Resend's email log **(verify on deploy)**. _Delivered_ means it reached the provider, so junk filtering is the cause. _Bounced_ or _suppressed_ is a different problem: go back to [§ 4](#4-step-by-step-checks).
2. **Read the authentication results in the message headers.** Ask the recipient to open the message source (Outlook: _View_ then _View message source_; Gmail: _Show original_) and to read you only the `Authentication-Results` line, not paste the whole source anywhere. The headers contain their address. Expect `spf=pass`, `dkim=pass` with `header.d=mail.3moji.me`, and `dmarc=pass`. Any `fail` or `none` is a DNS fault: check the records in [§ 3 DNS](#dns).
3. **Check the email is multipart.** The source should show `Content-Type: multipart/alternative`, with a `text/plain` part and a `text/html` part. Since #240 every email has both. A `text/plain` email alone means production is running a build from before #240, or the Resend adapter has stopped posting `html`.
4. **Have the recipient mark it as not junk.** In Outlook, _Not junk_; in Gmail, _Report not spam_. Adding the sending address to their safe senders or contacts helps too. It fixes that one mailbox, and the provider counts it as a signal for the domain.
5. **Look at the domain's reputation.** `mail.3moji.me` is a new sending domain, and a new domain with little volume has no reputation to lean on.
   - **Google Postmaster Tools** shows spam rate and domain reputation for mail to Gmail, once the domain is verified there. It shows data only after a sustained daily volume to Gmail, so an empty dashboard at low volume is normal **(verify on deploy)**.
   - **Microsoft SNDS** shows data per sending IP address, not per domain. Resend sends from shared IP addresses we do not control, so SNDS may not be available to us at all **(verify on deploy)**. For persistent junking at Outlook, Hotmail or Live addresses, Microsoft's sender support form is the route, and Resend's support can say whether their shared IPs have a known problem.
   - Both are optional owner registrations, listed on [owner actions](../owner-actions.md).
6. **Do not try to game the filter.** Do not send test emails in bulk to warm the domain, change the sending address, or add images or tracking. The emails are deliberately plain ([auth.md § What every email looks like](../architecture/auth.md#what-every-email-looks-like)). Reputation builds with steady, wanted mail and few complaints.
7. **A claimant with a held Handle is still in time.** If the verification email is in junk, the link in it works as long as it is the newest one and under an hour old. If it has expired, they press **resend** on the hold screen, as in [5a](#5a-a-claim-succeeded-but-its-email-did-not-arrive).

Record the provider (Outlook, Gmail and so on), the `Authentication-Results` outcome, and whether the recipient marked it not junk, in the record below. Never record the address.

## 6. Record

Keep the record **outside this repository**. It involves people's email addresses, which never go in a GitHub issue, commit or PR.

| Field            | What goes in it                                                                                                                                  |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Reported         | When, in UTC, how many people, and through what route                                                                                            |
| Email type       | Verification on Claim, collision notice, resend, or password reset                                                                               |
| Logs             | Whether the Vercel lines were captured in time; the failure `event`, `error.name`, `code` and `status`                                           |
| Resend status    | What Resend's log showed for the email: accepted, delivered, bounced, suppressed, or absent. For junk, the provider and the header results       |
| Daily count      | Resend's count for the day, when the cap is suspected                                                                                            |
| Cause and action | What was wrong, what was changed (names, never values), when, and by whom                                                                        |
| Held Handles     | Claimants in 5a's position: whether each resent in time or the hold lapsed. Record the Handle keys, not addresses, if a count is shared anywhere |
| Follow-up        | Owner decision raised (e.g. Resend Pro), issues opened, changes this runbook needs                                                               |
