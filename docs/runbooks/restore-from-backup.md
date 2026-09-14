# Restore from backup

What to do when production data is wrong or gone: a migration that damaged rows, an accidental delete, or a takedown run against the wrong Handle ([#207](https://github.com/joshstothard/3moji/issues/207)).

> **Written before the first deploy, and parts are unverified.**
>
> - [§ 4, Neon's restore window](#4-restore-from-neons-restore-window) covers the last six hours. Its console steps are marked **(verify on deploy)**.
> - [§ 5, the nightly backup](#5-restore-from-the-nightly-backup) is built ([#206](https://github.com/joshstothard/3moji/issues/206)), but **no backup has run and no restore has been performed yet**. Both are owner steps: [owner actions](../owner-actions.md), "Where nightly database backups are stored", steps 8 and 9. Until then, every command in § 5 is untested.

## Contents

1. [Symptoms](#1-symptoms)
2. [Act fast: the window is six hours](#2-act-fast-the-window-is-six-hours)
3. [Where to look](#3-where-to-look)
4. [Restore from Neon's restore window](#4-restore-from-neons-restore-window)
5. [Restore from the nightly backup](#5-restore-from-the-nightly-backup)
6. [After a restore](#6-after-a-restore)
7. [Record](#7-record)

## 1. Symptoms

- Claimed Handles show as unclaimed, or Profiles are blank or missing Links.
- Sign-in fails for people whose Accounts should exist.
- Failure lines show a schema SQLSTATE (for example `42P01` or `42703`) straight after a deployment that ran a migration. See [site down § 5d](site-down.md#5d-schema-and-code-disagree) first. A missing migration needs a redeploy, not a restore.
- Somebody ran SQL by hand, during a [takedown](takedown.md) for example, and it touched more rows than intended.

**Unreachable is not the same as lost.** If the site cannot reach the database at all, that is [site down](site-down.md). Restore only when the data itself is wrong.

## 2. Act fast: the window is six hours

**Neon Free can restore to a point within the last 6 hours, up to 1 GB-month** ([hosting and email report](../reports/2026-09-11-hosting-and-email.md) § 2). Anything older needs the nightly backup (§ 5), which keeps 30 days once the owner has set it up.

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

## 5. Restore from the nightly backup

> **Not yet performed.** No backup has run, and this restore has never been done against a real one. The owner's first green run and one test restore into a Neon scratch branch are outstanding ([owner actions](../owner-actions.md), "Where nightly database backups are stored", steps 8 and 9). Record that evidence on [#206](https://github.com/joshstothard/3moji/issues/206) (the date, the object key, and the § 5.4 counts, never rows), fix anything here that turned out wrong, and then delete this note.

This is the path when the damage is **older than six hours**.

**What exists.** `.github/workflows/backup.yml` runs every night at 03:17 UTC. It takes a custom-format `pg_dump` of production with `--no-owner --no-privileges`, pipes it straight into `age` encrypted to the owner's public key, and uploads it to a private Cloudflare R2 bucket as `3moji/YYYY/MM/DD/3moji-YYYYMMDDTHHMMSSZ.dump.age`. A bucket lifecycle rule deletes objects after 30 days. The age **private** key is only in the owner's password manager; without it no backup can be read. Nothing is written to the repository or to Actions artifacts, and a run that could not dump, produced a dump under 4 KiB, or could not confirm the upload fails.

**Where to do it.** On a trusted machine you control, never in a CI job, whose log is public. You need:

- `age` (`brew install age`).
- The AWS CLI (`brew install awscli`).
- A `pg_restore` of **major version 18 or later**, because the dump was made by `pg_dump` 18 and an older `pg_restore` refuses it (`brew install postgresql@18`, then check `pg_restore --version`).

**Never paste a secret onto a command line.** It ends up in shell history. Each `read -rs` below prompts without echoing, and the value lives only in that shell.

### 5.1 Pick the dump

1. In GitHub, **Actions → Nightly Database Backup**, find the newest **green** run from **before** the damage. Its last upload step ends `Uploaded and confirmed: N bytes.`
2. Put the R2 credentials into this shell. The workflow's token works, or make a read-only one in R2 for restores:

   ```bash
   read -rs AWS_ACCESS_KEY_ID && export AWS_ACCESS_KEY_ID
   read -rs AWS_SECRET_ACCESS_KEY && export AWS_SECRET_ACCESS_KEY
   export AWS_DEFAULT_REGION=auto
   export AWS_REQUEST_CHECKSUM_CALCULATION=when_required
   export AWS_RESPONSE_CHECKSUM_VALIDATION=when_required
   R2_ENDPOINT="https://<account-id>.r2.cloudflarestorage.com"
   ```

3. List that day's objects and pick the one whose size matches the run:

   ```bash
   aws s3api list-objects-v2 --endpoint-url "$R2_ENDPOINT" --bucket <bucket> \
     --prefix 3moji/YYYY/MM/DD/ --query 'Contents[].[Key,Size]' --output text
   ```

### 5.2 Download and decrypt

```bash
mkdir -m 700 ~/3moji-restore && cd ~/3moji-restore
aws s3api get-object --endpoint-url "$R2_ENDPOINT" --bucket <bucket> \
  --key <object-key> 3moji.dump.age > /dev/null

# Paste the private key file's contents from the password manager, then Ctrl-D.
umask 077 && cat > 3moji-backup.key
age --decrypt --identity 3moji-backup.key --output 3moji.dump 3moji.dump.age
rm 3moji-backup.key

pg_restore --list 3moji.dump | grep -c 'TABLE DATA'
```

The last line counts the tables with data in the dump. A decryption error means the wrong private key, or an object that is not a backup.

### 5.3 Restore into a scratch database, never production

Pick one. Both start empty, so nothing is overwritten.

- **Local Postgres 18:**

  ```bash
  createdb 3moji_restore
  pg_restore --no-owner --no-privileges --exit-on-error --dbname=3moji_restore 3moji.dump
  RESTORE_DATABASE_URL=postgresql:///3moji_restore
  ```

- **A Neon scratch branch** **(verify on deploy)**:
  1. In the Neon console, create a branch named `restore-<yyyymmdd>` from production.
  2. On **that branch**, create a new, empty database named `restore_check`. Restoring into a database that does not exist on production means a wrong connection string fails instead of touching production.
  3. Copy the branch's **direct** connection string (pooling off) for `restore_check`. Its host must not be production's.

  ```bash
  read -rs RESTORE_DATABASE_URL && export RESTORE_DATABASE_URL
  pg_restore --no-owner --no-privileges --exit-on-error --dbname="$RESTORE_DATABASE_URL" 3moji.dump
  ```

`--exit-on-error` stops at the first failure instead of restoring half a database silently.

### 5.4 Check it

The § 3 counts, against the restored database, and the migrations it carries:

```bash
psql "$RESTORE_DATABASE_URL" -c 'SELECT count(*) FROM handle;'
psql "$RESTORE_DATABASE_URL" -c 'SELECT count(*) FROM "user";'
psql "$RESTORE_DATABASE_URL" -c 'SELECT count(*) FROM profile;'
psql "$RESTORE_DATABASE_URL" -c 'SELECT max(claimed_at) FROM handle;'
psql "$RESTORE_DATABASE_URL" -c 'SELECT count(*) FROM drizzle.__drizzle_migrations;'
```

- `max(claimed_at)` should fall shortly before the backup's timestamp.
- The migration count should equal the number of `.sql` files in `packages/core/migrations/` at the commit that was live that night. If it is lower, see § 4 step 5.
- Counts that are zero, or far below what § 3 measured before the damage, mean the wrong dump: go back to 5.1.

### 5.5 Bring it back into production, last and deliberately

Only once 5.4 looks right, and § 2's steps are done: writes stopped and the damaging deployment rolled back.

1. **Branch production as it is now** in the Neon console **(verify on deploy)**, named `pre-restore-<yyyymmdd-hhmm>`. That is the undo.
2. **Narrow damage:** copy the affected rows from the scratch database into production, as § 4 step 3 describes: a reviewed, parameterised script, run once.
3. **Broad damage:** replace production's contents with the dump, in one transaction, so a failure leaves production as it was:

   ```bash
   read -rs PRODUCTION_DATABASE_URL && export PRODUCTION_DATABASE_URL
   pg_restore --no-owner --no-privileges --clean --if-exists \
     --single-transaction --exit-on-error \
     --dbname="$PRODUCTION_DATABASE_URL" 3moji.dump
   ```

   The connection string is production's **direct** one (pooling off). `--clean` drops each object before recreating it; that is the destructive step, and why it comes last.

4. **Schema must match the code:** § 4 step 5 applies unchanged.
5. Carry on with § 6.

### 5.6 Clean up

```bash
cd ~ && rm -rf ~/3moji-restore
dropdb 3moji_restore   # if you restored locally
unset AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY RESTORE_DATABASE_URL PRODUCTION_DATABASE_URL
```

The decrypted dump holds every Account's email address and password hash, so delete it the same day. Delete the Neon scratch branch too (§ 6 step 5).

Until the owner has enabled backups and one run is green, **there is no recovery for data lost more than six hours ago.** Say so plainly in the record.

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
| Source           | Neon restore window, or the nightly dump's object key                             |
| Target time      | The point restored to, and why that one                                           |
| Method           | Whole restore or copied rows; the branch name used                                |
| Lost writes      | How many boundary writes fell after the target time, and what was done about them |
| Takedowns re-run | Any from step 6.4                                                                 |
| Follow-up        | The issue fixing the cause, and any change this runbook or #206 needs             |
