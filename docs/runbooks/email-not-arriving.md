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

- A claimant says the hold screen told them to check their email, and nothing came.
- A claimant saw "something went wrong" on the claim form, and now the Handle shows as taken. See [§ 5a](#5a-a-claim-failed-after-it-committed); this one is urgent.
- The resend button or the password reset form answers with the generic failure state.
- Several people report it on the same day. Suspect the **Resend daily cap** first.

**Do not ask a reporter to post their email address in a GitHub issue.** Handle the conversation privately. This repository is public (`AGENTS.md` § This Repository Is Public).

## 2. Which email, and what sends it

Every email goes through the Resend adapter, `packages/core/src/auth/adapters/resend-email-sender.ts`. A failed send throws `ResendRequestRejected`, and the action that asked for it logs a failure line:

| Email                                          | Sent from                                                                  | Boundary line (`console.log`)                | Failure line (`console.error`)        |
| ---------------------------------------------- | -------------------------------------------------------------------------- | -------------------------------------------- | ------------------------------------- |
| Verification link, on a fresh Claim            | Better Auth's sign-up inside the Claim, held and **sent after the commit** | `claim.submit`, `outcome:"failed"`           | `claim_submit_failed`                 |
| "You already have an account" (collision)      | `notifyExistingOwner`, after the Claim collided                            | `claim.submit`, `outcome:"failed"`           | `claim_submit_failed`                 |
| Verification link, resent from the hold screen | `resendVerification`                                                       | `verification.resend`, `outcome:"failed"`    | `verification_resend_failed`          |
| Password reset link                            | `requestPasswordReset`                                                     | `password-reset.request`, `outcome:"failed"` | `password_reset_request_failed`       |
| Verification link via Better Auth's HTTP API   | `/api/auth/send-verification-email`                                        | `auth.post`, `outcome:"failed"`              | none of ours; Better Auth answers 5xx |

There is **no** separate event for the email itself, such as `auth_email_send_failed` or `claim_verification_email_failed`. Searching for one finds nothing. The failure line's `error` descriptor is what tells an email failure apart from a database one.

**A successful send writes nothing about the email.** Every answer that could reveal whether an address is registered logs the same `redirected` outcome (non-enumeration, [system-overview.md § API boundary logging](../architecture/system-overview.md#api-boundary-logging)). So "no failure line" means Resend accepted the email. It does not mean it was delivered.

## 3. Where to look

### The application's lines (Vercel runtime logs, **one hour only** on Hobby)

Capture them first, as in [site down § 2](site-down.md#2-capture-the-logs-now). Then search for the four failure events above and read `error`:

| `error` shows                                                                  | Meaning                                                                             | Go to                                                 |
| ------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------- | ----------------------------------------------------- |
| `"name":"ResendRequestRejected"`, `"code":"DAILY_QUOTA_EXCEEDED"`              | The **100 emails a day** cap on Resend Free is used up                              | [5b](#5b-the-daily-cap-is-used-up)                    |
| `"code":"MONTHLY_QUOTA_EXCEEDED"`                                              | The 3,000 a month cap is used up                                                    | [5b](#5b-the-daily-cap-is-used-up)                    |
| `"code":"RATE_LIMIT_EXCEEDED"`, usually `"status":"429"`                       | Too many requests a second to Resend's API, not the daily cap                       | [5c](#5c-resend-refused-the-request)                  |
| `"code":"MISSING_API_KEY"`, `INVALID_API_KEY` or `RESTRICTED_API_KEY`          | The key is wrong, revoked, or lacks send permission                                 | [5c](#5c-resend-refused-the-request)                  |
| `"code":"INVALID_FROM_ADDRESS"` or `VALIDATION_ERROR`                          | `RESEND_FROM` is not on a verified domain, or the sending domain lost verification  | [5c](#5c-resend-refused-the-request)                  |
| `"code":"UNRECOGNISED"`, with a `status`                                       | A Resend error the allow-list does not name. The status still says what class it is | [5c](#5c-resend-refused-the-request)                  |
| `"missing":"RESEND_API_KEY"` or `"missing":"RESEND_FROM"`                      | The variable is unset for Production. Every request needing email fails             | [site down § 5b](site-down.md#5b-fix-the-environment) |
| A code such as `ECONNREFUSED` or `ETIMEDOUT`, name not `ResendRequestRejected` | Resend's API could not be reached                                                   | Resend's status page; retry later                     |
| `"name":"DatabaseQueryFailed"`                                                 | Not email: the database failed before anything was sent                             | [site down](site-down.md)                             |

### Resend's dashboard **(verify on deploy)**

- **The email log**: was the email accepted, delivered, bounced, or marked as spam? Resend keeps it for 30 days (report § 5), so it outlives Vercel's hour. Search by recipient only in the dashboard, and never copy the address anywhere public.
- **Usage**: today's count against 100, and the month's against 3,000.
- **Domains**: the sending subdomain still shows as verified, with its SPF and DKIM records passing.
- **Resend's status page**, for an incident on their side.

### DNS

If the domain shows as unverified, check the SPF, DKIM and DMARC records for the sending subdomain at the DNS host. They are listed in the [hosting and email report](../reports/2026-09-11-hosting-and-email.md) § 5. A DMARC policy stricter than `p=none` makes a misconfiguration silently drop mail ([owner actions](../owner-actions.md)).

## 4. Step-by-step checks

1. **Capture the Vercel logs now**, before the hour passes.
2. **Is there a failure line** for the time the person tried? If yes, read `error` against the table in § 3 and go to its recovery step.
3. **If there is no failure line**, Resend accepted the email. Find it in Resend's email log **(verify on deploy)**:
   - _Delivered_: it reached the recipient's server. Ask them to check spam and any filters, and to search for the sending address.
   - _Bounced_: the address is wrong or the mailbox refuses mail. The person must use a different address. For a Claim, that means a new Claim once the hold lapses.
   - _Complained / suppressed_: the recipient marked a previous email as spam, and Resend will not send to them again. That is resolved in Resend's suppression list, not in 3moji **(verify on deploy)**.
   - _Not in the log at all_: the request never reached Resend. Recheck step 2 against the right time window and timezone. The logs may already be gone.
4. **Did the person hit a limit instead?** A resend refused as `too-soon` or `too-many` logs `outcome:"rate-limited"` on `verification.resend`, not a failure. The limits are in [auth.md § Resend, and its limits](../architecture/auth.md#resend-and-its-limits): 3 links an hour per Account, at least 60 seconds apart. That is working as designed. Tell them when to try again.
5. **Is it everybody?** Many failure lines with the same code on one day is the cap or a configuration fault, not one person's mailbox.

## 5. Recover

### 5a. A Claim failed after it committed

**The claim form said "something went wrong", but the Account and the held Handle exist.** The verification email is held back until the Claim's transaction commits, and sent after it (`runWithTransactionalAuth`, `packages/core/src/adapters/transactional-auth.ts`). So if that send fails, the commit has already happened. The action then logs `claim_submit_failed` and answers `failed`. The claimant believes nothing happened, and the Handle now shows as taken.

Trying the Claim again fails: the Handle is held by the claimant's own new Account. Instead:

1. Tell the claimant the Handle **is** held for them, for 24 hours from their Claim.
2. Ask them to sign in with the email and password they used. Better Auth answers `EMAIL_NOT_VERIFIED`, and the app sends them to their hold screen with a **resend** button ([auth.md](../architecture/auth.md)).
3. Once the email cause is fixed (5b, 5c), they press resend and get a fresh link.
4. If the cause cannot be fixed within the 24 hours, the hold lapses and the Handle is claimable again. Tell them so plainly. There is no tool to extend a hold.

A **collision notice** that fails is different. It is sent after the Claim has already found the address registered, so the Claim created nothing. The claimant sees `failed`, and the existing owner gets no notice. Nothing needs repairing; the claimant can simply try again later.

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
5. After any fix, ask one affected person to resend, and watch for the `verification.resend` line to come back `redirected` with no failure line.

## 6. Record

Keep the record **outside this repository**. It involves people's email addresses, which never go in a GitHub issue, commit or PR.

| Field            | What goes in it                                                                                                                                  |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Reported         | When, in UTC, how many people, and through what route                                                                                            |
| Email type       | Verification on Claim, collision notice, resend, or password reset                                                                               |
| Logs             | Whether the Vercel lines were captured in time; the failure `event`, `error.name`, `code` and `status`                                           |
| Resend status    | What Resend's log showed for the email: accepted, delivered, bounced, suppressed, or absent                                                      |
| Daily count      | Resend's count for the day, when the cap is suspected                                                                                            |
| Cause and action | What was wrong, what was changed (names, never values), when, and by whom                                                                        |
| Held Handles     | Claimants in 5a's position: whether each resent in time or the hold lapsed. Record the Handle keys, not addresses, if a count is shared anywhere |
| Follow-up        | Owner decision raised (e.g. Resend Pro), issues opened, changes this runbook needs                                                               |
