# Restore from backup

What to do when production data is wrong or gone: a migration that damaged rows, an accidental delete, or a takedown run against the wrong Handle ([#207](https://github.com/joshstothard/3moji/issues/207)).

> **Written before the first deploy, and half of it is pending.**
>
> - [§ 4, Neon's restore window](#4-restore-from-neons-restore-window) is the only restore available today. Its console steps are marked **(verify on deploy)**: there is no Neon project yet ([#19](https://github.com/joshstothard/3moji/issues/19), [#32](https://github.com/joshstothard/3moji/issues/32)).
> - [§ 5, the nightly backup](#5-restore-from-the-nightly-backup-pending-206) **does not exist yet**. It waits on [#206](https://github.com/joshstothard/3moji/issues/206) and on the owner's choice of destination ([owner actions](../owner-actions.md), "Where nightly database backups are stored"). #206 fills that section in, and must perform the restore once into a scratch database.

## Contents

1. [Symptoms](#1-symptoms)
2. [Act fast: the window is six hours](#2-act-fast-the-window-is-six-hours)
3. [Where to look](#3-where-to-look)
4. [Restore from Neon's restore window](#4-restore-from-neons-restore-window)
5. [Restore from the nightly backup (pending #206)](#5-restore-from-the-nightly-backup-pending-206)
6. [After a restore](#6-after-a-restore)
7. [Record](#7-record)

## 1. Symptoms

- Claimed Handles show as unclaimed, or Profiles are blank or missing Links.
- Sign-in fails for people whose Accounts should exist.
- Failure lines show a schema SQLSTATE (for example `42P01` or `42703`) straight after a deployment that ran a migration. See [site down § 5d](site-down.md#5d-schema-and-code-disagree) first. A missing migration needs a redeploy, not a restore.
- Somebody ran SQL by hand, during a [takedown](takedown.md) for example, and it touched more rows than intended.

**Unreachable is not the same as lost.** If the site cannot reach the database at all, that is [site down](site-down.md). Restore only when the data itself is wrong.

## 2. Act fast: the window is six hours

**Neon Free can restore to a point within the last 6 hours, up to 1 GB-month** ([hosting and email report](../reports/2026-09-11-hosting-and-email.md) § 2). Data damaged earlier than that has no restore today. That gap is why #206 exists.

So, before any diagnosis:

1. **Note the time the damage happened**, in UTC, as closely as you can: the deployment time, or when the SQL ran. The restore target is a moment **before** it.
2. **Stop further writes if the damage is spreading**, for example a bad deployment still running. Roll back the deployment ([site down § 5a](site-down.md#5a-roll-back-the-deployment)). Every Claim or edit after the target time is lost by a restore, so fewer is better.
3. **Capture the Vercel runtime logs now.** They last one hour on Hobby ([site down § 2](site-down.md#2-capture-the-logs-now)) and show which boundaries wrote during the window.

## 3. Where to look

- **The deployment list in Vercel** for what went out and when, and its **build** log for what the migrate step applied.
- **The runtime logs**: `api_boundary` lines with `outcome` `ok` or `redirected` on `claim.submit`, `claim.verify`, `profile.save` and `password-reset.set` are the writes a restore to an earlier time will lose. Count them. The lines carry no addresses or Handles, so they tell you _how many_ writes, not whose.
- **The database, read-only**, to measure the damage before choosing a target. Connect with `psql` to the **unpooled** connection, supplied through the environment and never pasted into a shell history or a note:

  ```bash
  # DATABASE_URL_UNPOOLED is read from a private env file, never typed or echoed.
  psql "$DATABASE_URL_UNPOOLED" -c 'SELECT count(*) FROM handle;'
  psql "$DATABASE_URL_UNPOOLED" -c 'SELECT count(*) FROM "user";'
  psql "$DATABASE_URL_UNPOOLED" -c 'SELECT count(*) FROM profile;'
  psql "$DATABASE_URL_UNPOOLED" -c 'SELECT max(claimed_at) FROM handle;'
  ```

  Counts and timestamps only. Do not select email addresses unless you need one, for the reason [takedown § 2a](takedown.md#2a-find-the-handle) gives. The tables are described in [data-model.md](../architecture/data-model.md).

## 4. Restore from Neon's restore window

**Restore into a new branch first, check it, and only then touch production.** Overwriting the live branch on a guess can lose the evidence of what went wrong and every good write since.

1. **Create a branch from a point in time** just before the damage, in the Neon console **(verify on deploy)** for where branching from a timestamp lives. Name it for the incident, e.g. `restore-<yyyymmdd-hhmm>`.
   - Neon Free allows **10 branches per project**, and preview deployments each create one (report § 2). If the limit is reached, delete stale `preview/*` branches first. Never delete the production branch.
2. **Check the restored branch**, with the same read-only counts as § 3, using that branch's own connection string. Confirm the damaged rows are back, and look at `max(claimed_at)` to see how recent it is.
3. **Choose how to bring it back**:

   | Situation                                                                     | Do this                                                                                                                                                                                              |
   | ----------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
   | Damage is broad (a migration), and few good writes happened since             | Restore the production branch to the chosen time in Neon **(verify on deploy)**. Neon's restore is expected to keep the pre-restore state as a backup branch; confirm that before relying on it      |
   | Damage is narrow (one table, a few rows), and many good writes happened since | Copy just those rows back from the restore branch into production, as a reviewed, parameterised SQL script run once. No interpolated values (`docs/development/engineering-standards.md` § Security) |

4. **Do not repoint `DATABASE_URL` at the restore branch by hand.** The Neon integration injects the connection variables ([owner actions](../owner-actions.md)). A hand-typed connection string drifts from the integration, and typing it risks leaking it.
5. **Schema must match the code.** If the target time is before a migration, the restored database lacks that migration. Either keep the older deployment serving, or let the next deployment's build re-apply the migration. If the migration was the cause, fix it in a PR first, so the rebuild does not damage the data again.

## 5. Restore from the nightly backup (pending #206)

> **Pending [#206](https://github.com/joshstothard/3moji/issues/206) and the owner's destination decision.** Nothing in this section exists yet. The shape below comes from #206's acceptance criteria. #206 replaces it with tested commands and the evidence of one restore into a scratch database.

This is the path when the damage is **older than six hours**.

What #206 is expected to provide:

- A scheduled GitHub Actions workflow takes a nightly logical dump of production, encrypts it, and uploads it to a private destination. The owner has not chosen the destination; the recommendation is a private S3-compatible bucket such as Cloudflare R2.
- **No dump is ever written to this repository or to Actions artifacts.** Both are public on a public repository. No secret or connection string is echoed in the workflow's log.
- A failed backup run fails loudly.

The restore, once #206 has written it, will cover:

1. Find the newest dump **before** the damage, in the private destination, and check the backup run that made it succeeded.
2. Download and decrypt it on a trusted machine, never in a CI job whose log is public. The key's location is recorded privately by the owner, never in the repository.
3. Restore into a **scratch** Neon branch or database first, and check it with § 3's counts.
4. Bring it back as in § 4 step 3: whole, or the affected rows only.
5. Delete the local decrypted copy. It holds every Account's email address and password hash.

Until #206 merges, **there is no recovery for data lost more than six hours ago.** Say so plainly in the record.

## 6. After a restore

1. Load `/` and a Profile you know was restored.
2. Watch the runtime logs for `failed` outcomes, especially a schema SQLSTATE.
3. **Writes after the target time are gone.** Claims, verifications, Profile edits and password changes made in that gap have to be redone by the people who made them. The boundary line count from § 3 says how many. Contacting people is an owner decision; there is no list of them in the logs by design.
4. A restore can bring back a Handle released by a takedown in the meantime. Re-run the [takedown](takedown.md) for any report acted on after the target time.
5. Delete the restore branch once it is no longer needed, to free a slot under the 10-branch limit.

## 7. Record

Keep the record **outside this repository**, in a private note the owner controls.

| Field            | What goes in it                                                                   |
| ---------------- | --------------------------------------------------------------------------------- |
| Damage           | What was wrong, when it happened (UTC), and how it was found                      |
| Cause            | The deployment, migration, or SQL that did it                                     |
| Measured         | The § 3 counts before and after. Counts, not rows                                 |
| Source           | Neon restore window, or (after #206) which nightly dump                           |
| Target time      | The point restored to, and why that one                                           |
| Method           | Whole restore or copied rows; the branch name used                                |
| Lost writes      | How many boundary writes fell after the target time, and what was done about them |
| Takedowns re-run | Any from step 6.4                                                                 |
| Follow-up        | The issue fixing the cause, and any change this runbook or #206 needs             |
