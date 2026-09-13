# Site down

What to do when `3moji.me` does not answer, answers with errors, or answers so slowly that people give up ([#207](https://github.com/joshstothard/3moji/issues/207)).

> **Written before the first deploy.** Nothing here has been run against production, because there is none yet: the deploy is [#32](https://github.com/joshstothard/3moji/issues/32), blocked on the accounts in [#19](https://github.com/joshstothard/3moji/issues/19). Steps marked **(verify on deploy)** describe what to accomplish in a dashboard whose exact screens have not been seen. Confirm them the first time they are used, and fix this page in the same sitting.

## Contents

1. [Symptoms](#1-symptoms)
2. [Capture the logs now](#2-capture-the-logs-now)
3. [Where to look](#3-where-to-look)
4. [Triage](#4-triage)
5. [Recover](#5-recover)
6. [Record](#6-record)

## 1. Symptoms

- `/` or a Profile page returns a 5xx, times out, or shows Vercel's own error page.
- Every form answers with the generic "something went wrong" state: a Claim, sign-in, resend or password reset all come back `failed`.
- A user reports an error and quotes an **`x-correlation-id`**. Every response carries one (`apps/web/src/proxy.ts`); ask for it if they have not given it.
- **No uptime check exists yet.** The check that should page the owner is the other half of #207 and waits on #32. Until it exists, this runbook starts when somebody notices.

## 2. Capture the logs now

**Vercel Hobby keeps runtime logs for one hour** ([hosting and email report](../reports/2026-09-11-hosting-and-email.md) § 4). After that the evidence is gone and the incident cannot be reconstructed. So before diagnosing anything:

1. Open the production deployment's runtime logs in the Vercel dashboard **(verify on deploy)**.
2. Filter to the last hour and export or copy the lines, into a private note outside this repository (see [§ 6](#6-record)).
3. Note the time you captured them, in UTC.

The lines are safe to keep privately. They are built so that no free text, email address or form value reaches them (`AGENTS.md` § Observability). Still, **never paste them into a GitHub issue or PR without reading them first**: this repository is public (`AGENTS.md` § This Repository Is Public).

## 3. Where to look

### The application's own lines

Two kinds of structured JSON line, sharing a `correlationId`:

| Stream          | `event`                                    | Written by                                       | What it tells you                                                                                                                                  |
| --------------- | ------------------------------------------ | ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `console.log`   | `api_boundary`                             | `atBoundary`, `apps/web/src/lib/boundary-log.ts` | One line per call at every route handler and server action: `boundary`, `outcome`, `durationMs`, `correlationId`, and `endpoint` on the auth route |
| `console.error` | a failure name, e.g. `claim_submit_failed` | `logFailure`, `apps/web/src/lib/log-error.ts`    | Why a call failed: `error.name`, and where known a `code`, `status`, `missing` variable and `causes` chain. **Never a message**                    |

Search the logs for:

- `"outcome":"failed"`: every boundary that could not answer. Group by `boundary` to see whether one path is broken or all of them are. The boundary names and outcome meanings are in [system-overview.md § API boundary logging](../architecture/system-overview.md#api-boundary-logging).
- The failure events: `claim_submit_failed`, `availability_check_failed`, `profile_read_failed`, `editable_profile_read_failed`, `edit_authority_read_failed`, `display_names_read_failed`, `hold_screen_lookup_failed`, `session_read_failed`, `viewer_summary_read_failed`, `profile_save_failed`, `verification_resend_failed`, `sign_in_rate_limit_failed`, `password_reset_request_failed`, `password_reset_set_failed`.
- A reporter's correlation id, to pair their boundary line with its failure line.

Page renders (`/`, a Profile) are not boundaries and write no `api_boundary` line. A failed Profile read still writes `profile_read_failed`, and a crash in a page shows in Vercel's own request log as a 500 **(verify on deploy)**.

### Reading the `error` descriptor

| What the line shows                                                                                            | Likely cause                                                                                                                      |
| -------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `"missing":"DATABASE_URL"` (or `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `RESEND_API_KEY`, `RESEND_FROM`)       | An environment variable is unset for Production. Services are built on first request, so the build passed and every request fails |
| `"name":"DatabaseQueryFailed"` with `"code":"ECONNREFUSED"`, `ETIMEDOUT` or `ENOTFOUND`                        | The database is unreachable: Neon down, compute suspended, or a wrong connection string                                           |
| `"name":"DatabaseQueryFailed"` with a SQLSTATE such as `42P01` (undefined table) or `42703` (undefined column) | The code expects a schema the database does not have: a migration did not run                                                     |
| `"name":"ResendRequestRejected"`                                                                               | Email, not the site. Go to [email not arriving](email-not-arriving.md)                                                            |

### The providers

- **Vercel status page and the deployment list.** Is there a Vercel incident? Did a deployment go out just before it started? Did the latest build fail and leave an older one serving?
- **Vercel usage.** Hobby has no pay-as-you-go: exceed a limit (function invocations, 4 CPU-hours of active CPU, data transfer) and "you will have to wait until 30 days have passed before you can use the feature again" (report § 4). **(verify on deploy)** where the usage page shows this.
- **Neon status page and the project's console.** Is compute running? Neon Free compute **suspends when the 100 CU-hours a month are exhausted** (report § 2), which looks exactly like a database outage. Scale-to-zero after 5 minutes idle is normal and resumes in a few hundred milliseconds. It is not an outage.

## 4. Triage

Work down the table. Stop at the first row that matches.

| Check                                                                                         | If yes                                                                                                         |
| --------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Vercel's status page reports an incident affecting deployments or functions                   | Wait it out. Record it. Nothing in this repository can fix it                                                  |
| The problem started with a deployment                                                         | [5a. Roll back the deployment](#5a-roll-back-the-deployment)                                                   |
| Failure lines name a `missing` variable                                                       | [5b. Fix the environment](#5b-fix-the-environment)                                                             |
| `DatabaseQueryFailed` with a connection code, and Neon reports an incident                    | Wait it out. Record it                                                                                         |
| `DatabaseQueryFailed` with a connection code, Neon is healthy, compute is suspended for quota | [5c. Compute quota exhausted](#5c-compute-quota-exhausted)                                                     |
| `DatabaseQueryFailed` with a schema SQLSTATE                                                  | [5d. Schema and code disagree](#5d-schema-and-code-disagree)                                                   |
| Vercel reports a plan limit exceeded                                                          | [5e. Hobby limit exceeded](#5e-hobby-limit-exceeded)                                                           |
| Data is wrong or missing, not unreachable                                                     | Stop. That is [restore from backup](restore-from-backup.md), and the clock on Neon's restore window is running |

## 5. Recover

### 5a. Roll back the deployment

1. In Vercel, promote the last deployment that was healthy back to Production **(verify on deploy)**. This is instant and changes no code.
2. Load `/` and one claimed Profile. Submit nothing that creates data.
3. **Migrations are not rolled back with the deployment.** Migrations run in the build step ([#32](https://github.com/joshstothard/3moji/issues/32), ADR-0006), so if the bad deployment applied one, the older code now runs against a newer schema. If failures continue with a schema SQLSTATE, see 5d.
4. Open an issue for the bad change (`capture`), and fix it forward on a branch. Do not revert on `main` by hand.

### 5b. Fix the environment

1. In the Vercel project's environment variables, confirm every name in `REQUIRED_VARIABLES` (`apps/web/src/lib/log-error.ts`) is set for **Production**. The list and what each holds is in [owner actions](../owner-actions.md) under "Create the hosting, database, email and DNS accounts". Compare **names only**. Never copy a value into a note, an issue or a chat.
2. `DATABASE_URL` and `DATABASE_URL_UNPOOLED` are injected by the Neon integration. If they are gone, reconnect the integration rather than typing a connection string in by hand **(verify on deploy)**.
3. A changed variable takes effect on the next deployment. Redeploy the current Production deployment.
4. **If a secret value may have leaked** while you were doing this, rotate it at its source first (`AGENTS.md` § This Repository Is Public). Rotating `BETTER_AUTH_SECRET` signs everybody out and invalidates outstanding verification and reset links.

### 5c. Compute quota exhausted

1. Confirm in the Neon console that the project's CU-hours for the month are used up **(verify on deploy)**.
2. There is no way to buy more on Free. The options are to wait for the month to reset, or to move to a paid Neon plan. That is a spending decision for the owner; record it in [owner actions](../owner-actions.md).
3. Once compute is back, check `/` and a Profile. Then look for what burned the hours. A preview branch left running, or unusual traffic, will show in the boundary lines' volume.

### 5d. Schema and code disagree

1. Compare the migrations in `packages/core/migrations/` on the deployed commit with what the database has applied. drizzle-kit records applied migrations in its own table **(verify on deploy)** for its name and location.
2. If a migration is missing, the build's migrate step did not run or failed. Read the deployment's **build** log (build logs are not the one-hour runtime logs) and fix the cause, then redeploy.
3. Never apply DDL by hand (`docs/development/engineering-standards.md` § Database Migrations). If a migration ran and **damaged data**, go to [restore from backup](restore-from-backup.md) now.

### 5e. Hobby limit exceeded

1. There is no quick fix on Hobby: the feature stays unavailable for up to 30 days.
2. The way out is the Vercel Pro upgrade, an owner decision already on [owner actions](../owner-actions.md) under "When to move to Vercel Pro". Tell the owner, with the usage figures.

### After any recovery

- Load `/` and one claimed Profile, and check the logs show `ok` and `redirected` outcomes again, not `failed`.
- If a Claim or email was lost during the outage, see [email not arriving](email-not-arriving.md) § 5a. A Claim that failed after its commit leaves a held Handle with no email.

## 6. Record

Keep the incident record **outside this repository**, in a private note the owner controls. It may hold log lines and correlation ids, and the owner decides what is safe to publish. A public follow-up issue can link to nothing private and quote no log without reading it first.

| Field           | What goes in it                                                                                    |
| --------------- | -------------------------------------------------------------------------------------------------- |
| Detected        | When, in UTC, and how: a user report, the owner noticing, or (once it exists) the uptime check     |
| Logs captured   | When, and where the copy is kept. Say so if the hour had already passed and they were gone         |
| Correlation ids | Any quoted by users, and one or two representative failing ones                                    |
| Cause           | Which triage row matched, and the evidence: the `event`, `error.name`, `code` or `missing` value   |
| Action taken    | What was done, when, and by whom: rollback target, variable names changed (never values), redeploy |
| Resolved        | When `/` and a Profile answered again                                                              |
| Knock-on        | Held Handles or emails affected, and what was done for them                                        |
| Follow-up       | The issue opened for the fix, and any change this runbook needs                                    |
