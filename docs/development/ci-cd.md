# CI/CD Pipeline

This project uses **GitHub Actions** for all CI and CD automation. There is no push to a registry by
default — the pipeline builds, versions, smoke-tests, and scans images, then stops. A disabled push
stub (guarded with `if: false`) is included so adopters can enable it in one line.

---

## Pipeline overview

```
push / PR
  │
  ├── Stage 1 (parallel fast checks)
  │     lint · typecheck · unit-tests · integration-tests
  │     i18n-check · code-health · openapi · adr-sync · script-tests
  │
  ├── Stage 2 (needs: all stage 1)
  │     build (artifact) · security (reusable workflow)
  │
  ├── Stage 3 (needs: build)
  │     e2e (Playwright + postgres service; Drizzle migrations applied first)
  │
  ├── Stage 4 (independent)
  │     version (GitVersion → semver output)
  │
  └── Stage 5 (needs: e2e + security + version)
        image-api · image-web
          ├── docker build --build-arg APP_VERSION=<semver>
          ├── ci-smoke-test.sh (health + version probes)
          ├── Trivy scan (blocking on fixable CRITICAL)
          └── [push disabled — see below]
```

## Workflows

| File                                         | Trigger                                                         | Purpose                               |
| -------------------------------------------- | --------------------------------------------------------------- | ------------------------------------- |
| `.github/workflows/ci.yml`                   | PR, push to `main`, `workflow_dispatch`                         | Full pipeline                         |
| `.github/workflows/auto-merge.yml`           | CI run completed, PR labelled `automerge`, `workflow_dispatch`  | Merge PRs once CI passes              |
| `.github/workflows/security.yml`             | `workflow_call`, `workflow_dispatch`                            | Reusable security job                 |
| `.github/workflows/nightly-security.yml`     | `workflow_dispatch` only (daily 06:00 UTC schedule disabled)    | Calls `security.yml`                  |
| `.github/workflows/nightly-mutation.yml`     | `workflow_dispatch` only (weekdays 02:00 UTC schedule disabled) | Stryker mutation testing              |
| `.github/workflows/morlock.yml`              | `workflow_dispatch` only (nightly 01:00 UTC schedule disabled)  | Morlock security probe                |
| `.github/workflows/backup.yml`               | Nightly 03:17 UTC schedule (enabled), `workflow_dispatch`       | Encrypted database backup to R2       |
| `.github/workflows/neon-preview-cleanup.yml` | PR closed, hourly :23 sweep (enabled), `workflow_dispatch`      | Delete Neon preview database branches |

### Scheduled workflows are manual-only

Per [ADR-0002](../adr/0002-track-work-in-github-issues.md), the nightly workflows keep their `schedule:` blocks commented out to conserve GitHub Actions minutes on a private repository. Run them from the repository's **Actions** tab, or from the command line:

```bash
gh workflow run nightly-security.yml
gh workflow run nightly-mutation.yml
```

To restore a schedule, uncomment its `schedule:` block. `morlock.yml` was already manual-only for a separate reason recorded in the workflow file (scheduled runs were being rejected by the Anthropic API); follow that note before re-enabling it. `security.yml` still runs as a blocking stage of `ci.yml` on every PR, so audit regressions are caught without the nightly run.

**`backup.yml` is the exception: its schedule is on** ([#206](https://github.com/joshstothard/3moji/issues/206)). A backup that has to be remembered is not a backup, the repository is now public so the minutes are free, and until the owner sets the `BACKUPS_ENABLED` variable to `true` every run is a green no-op that stops after one step. It runs only on `main` of `joshstothard/3moji`, never on a fork. Because this repository's logs and artifacts are public, the dump is piped from `pg_dump` straight into `age`, never uploaded as an artifact, and removed from `$RUNNER_TEMP` even on failure. The database password goes in a mode-600 libpq password file there, never on `pg_dump`'s command line. `scripts/backup-workflow-guard.test.mjs` fails the Script tests job if the workflow gains an artifact upload, `set -x`, an `echo` of a secret or variable name, or an expression pasted into a script. The decisions (skip, fail naming what is missing, object key, size checks) are `scripts/backup-plan.mjs`, tested in `scripts/backup-plan.test.mjs`. Restoring is [restore from backup § 5](../runbooks/restore-from-backup.md#5-restore-from-the-nightly-backup).

**`neon-preview-cleanup.yml`'s hourly sweep is on too** ([#258](https://github.com/joshstothard/3moji/issues/258)), for the same reasons: until `NEON_CLEANUP_ENABLED` is `true` every run is a green no-op, and the repository is public, so the minutes are free. See § Neon preview cleanup.

## Auto-merge

Per [ADR-0003](../adr/0003-auto-merge-pull-requests-on-green-ci.md), pull requests merge themselves. GitHub's native auto-merge and branch protection need GitHub Pro on a private repository, so `auto-merge.yml` does the job with the workflow's `GITHUB_TOKEN`. The decision is `scripts/auto-merge.mjs`, unit-tested in `scripts/auto-merge.test.mjs`.

**Triggers:** a CI run completing on a PR branch, the `automerge` label being added, or a manual run (`gh workflow run auto-merge.yml -f pr=<number>`; leave `pr` out to evaluate every open PR, and add `-f dry_run=true` to log the decisions without acting). Every trigger runs the workflow and the script from `main` and never checks out PR code, so a pull request cannot steer the write token. Runs are serialised in one concurrency group, and each run evaluates every open PR, starting with the one that triggered it. GitHub keeps only the newest pending run in a group, so a replaced run loses nothing. A run that is waiting for CI after a branch update (below) holds the group while it waits, so other PRs' runs queue behind it: an unrelated merge can be delayed by up to the 20-minute wait budget, never lost.

A PR merges when every rule holds. Each run logs one line per PR with the reason code.

| Rule                                                                                    | Otherwise                                                                                                                                                                                                                                                  |
| --------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Open, not a draft, based on `main`                                                      | skipped (`not-open`, `draft`, `base-not-main`)                                                                                                                                                                                                             |
| Labelled `automerge`, or opened by Dependabot with only semver-minor and -patch updates | skipped (`not-opted-in`, `dependabot-major`, `dependabot-no-metadata`)                                                                                                                                                                                     |
| No reviewer's latest verdict is "changes requested"                                     | skipped (`changes-requested`)                                                                                                                                                                                                                              |
| The newest CI run that was allowed to start on the PR's current head succeeded          | skipped (`ci-missing`, `ci-stale`, `ci-not-started`, `ci-running`, `ci-failed`)                                                                                                                                                                            |
| No merge conflicts                                                                      | skipped (`conflicts`, or `mergeability-unknown` while GitHub is still computing it)                                                                                                                                                                        |
| Up to date with `main`                                                                  | branch updated from `main`, CI dispatched on it, and the same run waits for that CI and evaluates the PR again (`behind-main`); skipped when it cannot see that through (`ci-still-running-after-update`, `behind-main-after-update`, `wait-budget-spent`) |

The merge is a squash with the branch deleted, or a merge commit when another open PR is stacked on the branch.

**Never ran, still running, and failed are three different states**, and the gate must keep them apart. GitHub creates a workflow run for a commit authored by `GITHUB_TOKEN` and then refuses to start it: zero jobs, `action_required` in `status` or `conclusion`, waiting for a human to approve it. That is evidence of nothing. Reading it as a verdict is what made auto-merge report `ci-failed` on a PR whose every check was green, permanently, for any PR it had updated from `main` ([#125](https://github.com/joshstothard/3moji/issues/125)). So `latestCiRun` fetches a page of runs rather than one — the blocked run and the dispatched run share a `created_at`, so listed order does not separate them — ignores runs that never started, and reports `ci-not-started` when a head has nothing but those. Resolve one by approving the run in the Actions tab, or by re-dispatching CI (`gh workflow run ci.yml --ref <branch>`).

**GitHub does not keep the `action_required` label, so never judge a run by its conclusion alone** ([#145](https://github.com/joshstothard/3moji/issues/145)). The refused run is later finalised as `conclusion: failure`, still with zero jobs. Measured on 2026-09-13: run `34745540993` on #128 read `action_required` in the morning and `failure` by midday, and run `34755777779` on #142 reads `failure` with its `updated_at` at the moment the PR merged; both have `total_count: 0` jobs, and both check suites read `latest_check_runs_count: 0`. A gate evaluation after the relabel would otherwise report `ci-failed` for a PR whose every real check is green. So a run counts as never started when it reads `action_required`, **or** when it completed without success and has zero jobs, whatever its conclusion; a run with jobs that failed, was cancelled or timed out is still a failure, and a queued or running run is never judged by its jobs, since it may not have created them yet. The job count comes from the run's `jobs?per_page=1` endpoint (`total_count`), read only for a completed non-success run the selection walks past, so a green head costs no call beyond the run list and a #142-shaped head costs one more. The check suite's `latest_check_runs_count` would cost the same call but needs `checks: read`, which the workflow does not grant. **If the job count cannot be read, the gate fails closed:** it logs a `::warning` naming the run and the error, and judges that run as one that started, so the PR is skipped with `ci-failed` rather than merged on an older green run. The next gate run reads it again.

**`GITHUB_TOKEN` side effects.** A merge or branch update made with `GITHUB_TOKEN` does not trigger `push` or `pull_request` workflows, so the script dispatches `ci.yml` itself (`workflow_dispatch` is exempt): on `main` after every merge, and on the PR branch after an update. After a merge it re-evaluates the other open PRs, so any left behind `main` are updated.

The exemption covers the dispatch itself and nothing downstream of it. Measured on 2026-09-13: a CI run that auto-merge dispatched on a PR branch (`34742611694`, completed 06:28:00) started no Auto-merge run, and neither did `34742068590` on another branch (completed 06:15:06), while every human-triggered CI completion that day did start one within two seconds. The `workflow_run` event raised by a `GITHUB_TOKEN`-started run is suppressed just like a `push` event would be, so no later run can be relied on to evaluate a PR the gate updated — on #128 one sat green, labelled and mergeable for over ten minutes ([#58](https://github.com/joshstothard/3moji/issues/58)).

**So the run that updates a branch finishes the job itself.** After dispatching CI on the new head it polls every 15 seconds until that run completes, then evaluates the PR again through exactly the same rules as above, and merges only if they all hold on the head as it is then. The dispatch API returns no run id, so the dispatched run is recognised as a `workflow_dispatch` run at the new head created no earlier than the dispatch; completion only ends the wait, and the verdict is still read from every run at the head, as above. If `main` moved during the wait, the PR is updated and waited on once more, and after two updates it is skipped (`behind-main-after-update`). The run's waiting is capped at 20 minutes across every PR it evaluates (CI takes about five), with the job's `timeout-minutes` at 30 above that. When the budget runs out, a PR still waiting is skipped with `ci-still-running-after-update`, and a PR not yet updated is left alone once less than 6 minutes remain (`wait-budget-spent`) rather than updated with nothing left to see its CI through. Neither is a failure: the next run evaluates the PR again, and `gh workflow run auto-merge.yml -f pr=<number>` does so on demand. **Do not remove this wait, and do not replace it with a trigger** — every event downstream of the gate's own writes is suppressed. The workflow's `actions: write` permission covers the dispatch, and is also what lets `GITHUB_TOKEN` merge a PR that changes files under `.github/workflows/`. `GITHUB_TOKEN` cannot reach the user-owned Project board, so `epic-sync` does not run for auto-merged PRs. When an epic's last issue auto-merges, run `node scripts/gh-workflow.mjs epic-sync <issue-number>`.

**The gate closes a merged PR's issues itself** ([#42](https://github.com/joshstothard/3moji/issues/42)). GitHub's `Closes #N` automation does not fire for a merge made with `GITHUB_TOKEN`. Measured on 2026-09-13: PRs #130 and #127, merged by the gate, left #36 and #125 open until they were closed by hand, while PRs #131 and #133, merged by a person, closed #43 and #115 within two seconds. So after a successful merge the script reads the PR's `closingIssuesReferences` over GraphQL and closes each issue on it that is in this repository and still open, commenting `Closed by #<pr> (merged by the auto-merge gate).` That list is GitHub's own, so `Part of #N` and `Refs #N` never close anything. An issue that is already closed is left alone, with no second comment. If reading the list or closing an issue fails, the run logs a `::warning` annotation and does not fail: the merge has already happened, and it is never retried. Close that issue by hand. This is what the workflow's `issues: write` permission is for, since `pull-requests: write` covers comments on a pull request but not on an issue. ADR-0003's Consequences say auto-merged issues close through `Closes #N`; that was never true, and this paragraph is the correction.

**The gate does not set the board column.** Setting a status on a user-owned Projects v2 board needs a token with the `project` scope, which `GITHUB_TOKEN` cannot have, and no PAT is configured. It does not need to: the board's built-in _Item closed_ workflow moves an issue to Done when it closes, **including when the gate closes it with `GITHUB_TOKEN`**. Measured on 2026-09-13: the gate merged PR #141 and closed [#137](https://github.com/joshstothard/3moji/issues/137) as `github-actions[bot]`, and #137 reached Done although its board status had been left at In Review and nobody changed it afterwards. So a gate merge needs no manual follow-up for the issue or its column. If the built-in workflow is ever disabled, set the column with `node scripts/gh-workflow.mjs status <number> Done`, which is what `pr-action-review` does after a merge.

**When it cannot merge:** a failed merge or branch update is posted as a comment on the PR, and the run fails so it shows in the Actions tab. Merge by hand with `gh pr merge <number> --squash --delete-branch`.

**Holding a PR:** remove the `automerge` label, or convert the PR to a draft (`gh pr ready <number> --undo`). A Dependabot minor or patch PR has no label to remove, so convert it to a draft or close it.

**A Dependabot bump of `better-auth` or `@better-auth/*` fails CI, so it never auto-merges.** That is intended. `scripts/better-auth-audit.test.mjs` pins the audited version until someone does the recheck in [auth.md § Rechecking the Account-creation audit](../architecture/auth.md#rechecking-the-account-creation-audit) ([#169](https://github.com/joshstothard/3moji/issues/169)).

## Neon preview cleanup

The Vercel-managed Neon integration creates a `preview/<git branch>` database branch for each preview deployment, and deletes it only when Vercel deletes the last deployment on it, which by default is after about six months ([Neon: preview branch cleanup](https://neon.com/docs/guides/vercel-branch-cleanup), read 2026-09-14). Neon Free allows 10 branches per project, and the project reached that on 2026-09-14 ([#258](https://github.com/joshstothard/3moji/issues/258)). `neon-preview-cleanup.yml` deletes them sooner:

- **When a pull request closes**, it deletes the branch named exactly `preview/<head branch>`, unless another open pull request uses the same git branch.
- **Every hour, at minute 23, and on a manual run, it sweeps** (`gh workflow run neon-preview-cleanup.yml`, or **Run workflow** in the Actions tab, from `main`): it deletes every `preview/` branch whose name, after the prefix, is neither an open pull request's head branch nor the start of one. Neon may shorten a long branch name, so a branch that could be a shortened open head branch is kept. The close path does not use this rule and deletes on an exact match only.
- **It never deletes** `main`, the project's default branch, a protected branch, or any branch without the `preview/` prefix. Deleting a branch that is already gone counts as success; a delete Neon refuses fails the run, after the other deletes have been tried.

**A merge by the auto-merge gate does not raise the close event.** The gate merges with `GITHUB_TOKEN`, and GitHub raises no `pull_request` event for that (§ Auto-merge), and almost every pull request here merges through the gate. So the close trigger covers pull requests merged by hand or closed without merging, and **the hourly sweep is what cleans up after auto-merged pull requests**, and after forks and Dependabot. **Decided on 2026-09-14:** an hourly scheduled sweep, chosen by the orchestrator for the owner, who asked for automatic cleanup. An auto-merged pull request's branch is therefore gone within about an hour of the merge.

**Until repository variable `NEON_CLEANUP_ENABLED` is `true`, every run is a green no-op** with a notice. Once it is, a missing `NEON_API_KEY` or `NEON_PROJECT_ID` fails the run, naming what is missing. A pull request from a fork, or a run Dependabot triggered, gets no secrets, so it is skipped with a notice rather than failed; the next sweep deletes its branch.

**Every decision is in `scripts/neon-preview-cleanup.mjs`**, tested in `scripts/neon-preview-cleanup.test.mjs` against a fake Neon and GitHub API. The script is also the only thing that calls an API: it sends the key to Neon in a request header from Node, so the key never goes on a command line, and it prints branch names and HTTP statuses, never a response body, the key or the project ID. `scripts/neon-preview-cleanup-workflow-guard.test.mjs` checks the workflow as text: `pull_request`, never `pull_request_target`; a `schedule:` sweep; no `set -x`; no `echo` or `printf` of the key, the project or the switch; no `${{ }}` expression pasted into a script, because a head branch name is chosen by whoever opens the pull request; no `curl`, `neonctl` or third-party action; read-only permissions; only this repository, and a manual run only from `main`. The job checks out the default branch, so the script that runs is `main`'s, never the closing pull request's.

**Permissions** are `contents: read` and `pull-requests: read`. The second is what lets `GITHUB_TOKEN` list open pull requests, so a branch still in use is never deleted; if that list cannot be read, nothing is deleted.

**Why not `neondatabase/delete-branch-action`.** Neon's guide suggests it, but it installs `neonctl` from npm at run time and passes the key to it, and it resolves a branch name itself. The script here matches names exactly, refuses anything but `preview/`, and is tested.

## Versioning

Semantic versions are computed by [GitVersion](https://gitversion.net) in `ContinuousDelivery` mode
(`GitVersion.yml`). The `version` job runs with `fetch-depth: 0` so GitVersion can walk the full
git history. Its `semver` output flows into the docker build args and image tags of Stage 5.

`package.json` versions stay at `0.0.0` — the real version comes only from CI.

### Version bump rules

| Situation                                | Version bump                             |
| ---------------------------------------- | ---------------------------------------- |
| Merge to `main`                          | Minor (e.g. `1.2.0`)                     |
| Feature branch build                     | Pre-release patch (e.g. `1.2.0-alpha.3`) |
| Commit message contains `+semver: major` | Major                                    |
| Commit message contains `+semver: minor` | Minor                                    |
| Commit message contains `+semver: patch` | Patch                                    |
| Commit message contains `+semver: none`  | No bump                                  |

## Image push (disabled by default)

The image build jobs contain a commented-out push step guarded with `if: false`. To enable:

1. Uncomment and adjust the push step in `ci.yml` (`image-api` and `image-web` jobs).
2. Change `if: false` to your desired branch condition (e.g. `if: github.ref == 'refs/heads/main'`).
3. Add a registry login step (GHCR default is shown, commented out).
4. Provide the relevant secrets (`GITHUB_TOKEN` is already available for GHCR).

Default image name: `app-web`.

**Adding a workspace package means editing `apps/web/Dockerfile`.** It has its own dependency install and its own build sequence, neither of which uses Turborepo's task graph, so a new local package must be added to both: the `npm ci --workspace=` list, or its dependencies are missing from the image, and the build sequence before `apps/web`, or the app cannot resolve its `dist`. Nothing else in the pipeline catches this — lint, typecheck, unit tests, the Turbo build and the E2E suite all pass, and only the image build fails. Default registry: `ghcr.io/${{ github.repository }}`.

## Smoke test

`scripts/ci-smoke-test.sh` is run by Stage 5 after each image build. It:

1. Starts the image in a container.
2. Waits for `/healthz` to respond.
3. Asserts `/version` returns `{ "version": "<semver>" }` — **build fails on mismatch**.
4. Cleans up the container.

Pass `POSTGRES_DSN` and `REDIS_URL` env vars to the script if sidecars are needed.

## Security pipeline

`security.yml` (called by `ci.yml` Stage 2 and `nightly-security.yml`) runs:

- **npm audit** — fails on `high` severity
- **Secretlint** — scans all files for committed secrets
- **CycloneDX SBOM** — generates `sbom.json`, uploaded as an artifact
- **Semgrep** — `p/owasp-top-ten`, `p/javascript`, `p/typescript`, `p/nodejs` rulesets; SARIF uploaded to the Security tab

### npm overrides — keeping the audit gate green

Transitive dependencies that Dependabot cannot bump directly are pinned via the `overrides` block in root `package.json`. This lets the `--audit-level=high` gate stay green without requiring breaking upgrades to direct dependencies.

**Current overrides and why they exist.** An exact pin earns its place only while a consumer's declared range still admits a version below the advisory's fix line for that major; once every consumer's own range clears the fix, the pin is a stale snapshot waiting to go wrong (see `docs/development/engineering-standards.md` § Dependency Management). Every entry is scoped to a major, so it cannot be forced onto a consumer that needs a different one.

| Package                                               | Pinned to | Consumer and declared range                                                                                                        | Advisory and fix line                                                                                    | Still needed?                                                                       |
| ----------------------------------------------------- | --------- | ---------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `picomatch@2`                                         | `2.3.2`   | `anymatch` (`^2.0.4`, via `jest-haste-map`) and `micromatch` (`^2.3.1`, via `@next/eslint-plugin-next` → `fast-glob`)              | GHSA-c2c7-rcm5-vvqj (high), fixed `2.3.2`                                                                | **Yes** — `anymatch`'s range admits versions below the fix                          |
| `brace-expansion@1`                                   | `1.1.18`  | `minimatch@3` (`^1.1.7`, via `eslint-plugin-react` and `eslint-plugin-jsx-a11y`)                                                   | GHSA-rgw5-rvv9-x895 (high), 1.x fixed `1.1.18`                                                           | **Yes** — `^1.1.7` admits `1.1.7`–`1.1.17`                                          |
| `brace-expansion@2`                                   | `2.1.4`   | `minimatch@9` (`^2.0.2`, via `test-exclude` → `glob@10`)                                                                           | GHSA-rgw5-rvv9-x895 (high), 2.x fixed `2.1.4`                                                            | **Yes** — `^2.0.2` admits `2.0.2`–`2.1.3`                                           |
| `brace-expansion@5`                                   | `5.0.9`   | `minimatch@10` (`^5.0.8`, via `eslint`, `@eslint/config-array`, `@typescript-eslint/typescript-estree`, `glob@13`, `test-exclude`) | GHSA-rgw5-rvv9-x895 (high), 5.x fixed `5.0.9`                                                            | **Yes** — `^5.0.8` admits `5.0.8`                                                   |
| `fast-uri@3`                                          | `3.1.6`   | `ajv@8` (`^3.0.6`, via `secretlint`)                                                                                               | GHSA-5jgf-p345-68v8, GHSA-f65p-4m7j-42xc, GHSA-fph4-wmhf-6fwf, GHSA-jqff-g426-hqxp (high), fixed `3.1.6` | **Yes** — `^3.0.6` admits versions below the fix                                    |
| `js-yaml@4`                                           | `4.3.2`   | `@textlint/linter-formatter` (`^4.3.0`) and `rc-config-loader` (`^4.1.1`), both via `secretlint`                                   | GHSA-2883-xcg3-v3hh (high), 4.x fixed `4.3.2`                                                            | **Yes** — both ranges admit versions below the fix                                  |
| `js-yaml@3`                                           | `3.15.2`  | `@istanbuljs/load-nyc-config` (`^3.13.1`, via `babel-plugin-istanbul` → `@jest/transform` → `ts-jest`; dev-only)                   | GHSA-2883-xcg3-v3hh (high), 3.x fixed `3.15.2`                                                           | **Yes** — `^3.13.1` admits `3.13.1`–`3.15.1`                                        |
| `eslint-plugin-jsx-a11y` / `eslint-plugin-react` peer | `$eslint` | `@template/eslint-config`                                                                                                          | None — a peer-range override, not a security pin                                                         | **Yes**, until upstream widens its `eslint` peer range to cover the installed major |

**Changed in [#137](https://github.com/joshstothard/3moji/issues/137).** Both entries were decided by the rule above — does a consumer's declared range admit a version below the fix line for that major? — which is why one exact pin went and another arrived. Verified with a full clean install, `npm ls sharp js-yaml --all` (exit 0), a per-consumer walk-up resolution of the whole lockfile before and after, and a behavioural check that `require`s each package from its consumer. The regenerated `package-lock.json` is byte-identical to `main`'s, so no consumer's resolved version changed; that includes all 28 `sharp` and `@img/*` platform-binary entries the Web image's `npm ci --ignore-scripts` depends on. `npm audit --audit-level=high` reported zero high findings before and after:

| Entry       | Was                | Now      | Why                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ----------- | ------------------ | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `sharp`     | `0.35.4`, unscoped | removed  | Its only consumer, `next`, declares `sharp` as an optional dependency at `^0.35.4` (`>=0.35.4 <0.36.0`), already at the fix line for GHSA-rgj7-g3m4-5g8c (high) and above every earlier `sharp` advisory. The pin changed no resolution — `npm ls` never marked `sharp` `overridden` — and as an exact pin it would have forbidden a future `0.35.x` fix. A fix that lands outside `next`'s range is resolved by bumping `next`, not by an override |
| `js-yaml@3` | —                  | `3.15.2` | `@istanbuljs/load-nyc-config` declares `^3.13.1`, which admits `3.13.1`–`3.15.1`: below the 3.x fix lines of GHSA-2883-xcg3-v3hh (`3.15.2`), GHSA-5p4m-2wfm-xmqj (`3.15.1`) and GHSA-52cp-r559-cp3m (`3.15.0`), all high. It resolved to `3.15.2` only because that is the newest 3.x release, so the floor moves nothing today                                                                                                                     |

**Changed in [#132](https://github.com/joshstothard/3moji/issues/132).** Verified the same way as #43 below: a full clean install, then `npm ls <package> --all`. Afterwards `npm ls` reported no invalid entry (it had exited `ELSPROBLEMS` before), and `npm audit --audit-level=high` reported zero high findings before and after:

| Entry             | Was               | Now                                       | Why                                                                                                                                                                                                                                                                                                                                                            |
| ----------------- | ----------------- | ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `brace-expansion` | `5.0.9`, unscoped | `@1` `1.1.18`, `@2` `2.1.4`, `@5` `5.0.9` | The unscoped pin forced 5.x onto `minimatch@3` and `minimatch@9`. 5.x exports `{ expand }` where 1.x and 2.x export the function itself, so `minimatch@3` threw `expand is not a function` on any call. It was broken at runtime, not just reported invalid. Each major now gets its own GHSA-rgw5-rvv9-x895 fix line                                          |
| `js-yaml@5`       | `5.4.1`           | removed                                   | No consumer — only `js-yaml` 3.x and 4.x are installed                                                                                                                                                                                                                                                                                                         |
| `postcss@8`       | `8.5.24`          | removed                                   | `next` pins `postcss` at exactly `8.5.23`, which is at or above every postcss fix line (the highest, GHSA-fxqj-rqcc-2cmp, is fixed in `8.5.23`). The pin added no security and put `next` outside its own pin. Re-pinning to `8.5.23` would go invalid again on the next `next` bump. `@tailwindcss/postcss` (`^8.5.16`) now resolves the newest 8.x, `8.5.28` |

**Removed in [#43](https://github.com/joshstothard/3moji/issues/43).** Four overrides had lost the NestJS root cause that justified them when `apps/api` was deleted ([ADR-0006](../adr/0006-nextjs-on-vercel-is-the-whole-application.md)). Each removal was verified with a full clean install (every `node_modules` and `package-lock.json` deleted) followed by `npm ls <package> --all`, and `npm audit --audit-level=high` reported zero high findings before and after:

| Removed       | Was pinned to | Why it could go                                                                                                                                                                                    |
| ------------- | ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tmp`         | `0.2.7`       | No consumer — `npm ls tmp` is empty                                                                                                                                                                |
| `multer@2`    | `2.3.0`       | No consumer — `npm ls multer` is empty. No `multer` lockfile patch remained either; it left the lockfile with `apps/api`                                                                           |
| `picomatch@4` | `4.0.5`       | The pin had gone stale: it held `lint-staged` (which declares `^4.0.7`) **below its own range**. Without it every 4.x consumer dedupes onto `4.0.7`, above the `4.0.4` fix for GHSA-c2c7-rcm5-vvqj |
| `lodash`      | `4.18.1`      | Its only consumer, `@textlint/linter-formatter` (via `secretlint`), declares `^4.18.1` itself — already above the `4.18.0` fix for GHSA-r5fr-rjxr-66jc                                             |

**Maintenance rule:** when a HIGH-severity transitive finding appears:

1. Add an override entry to `overrides` in root `package.json` pinning to the safe version.
2. Run `npm install` to regenerate the lockfile.
3. If the override doesn't propagate (workspace-nested exact pin), patch the lockfile entry directly.
4. When the direct dependency ships a clean upgrade via Dependabot, remove the override and any lockfile patch at that point.

Trivy runs separately per image in Stage 5 with two passes: blocking on fixable CRITICAL, SARIF report for CRITICAL+HIGH.

**Private repositories:** uploading SARIF to GitHub code scanning (the Security tab) requires GitHub Code Security on a private repo; without it the upload step fails with `Resource not accessible by integration`. The Trivy and Semgrep upload steps therefore run only when the repository is public (`!github.event.repository.private`). The blocking Trivy pass and the Semgrep scan itself still run on every PR, so the security gate is unchanged; only the Security-tab report is skipped. If the repo becomes public or gains Code Security, the uploads resume automatically.

## ADR sync check

`adr-sync` (Stage 1) runs `scripts/check-adr-sync.sh`, which fails the build if a diff touches
`docs/adr/*.md` without also touching `docs/architecture/*.md` in the same diff — see AGENTS.md §
ADR reading policy. It no-ops until `docs/architecture/` exists. Skip it for a specific ADR with no
current-state doc to update by adding `[skip-adr-sync: reason]` to a commit message on the branch.

The same job runs `scripts/check-adr-numbers.mjs`, which fails if two files in `docs/adr` share a
four-digit number. A pull request is checked out as its merge with `main`, so it also catches a number
that merged to `main` after the branch was cut. ADR-0003 reached `main` twice before this check
existed, and the repair meant editing an Accepted ADR (#35, #36). The `adr` skill numbers from
`origin/main` and open pull requests; this check is the backstop when the skill is bypassed or two
branches still race. Unlike `adr-sync` it has no skip marker. It also runs in `scripts/verify.sh`.

## Morlock

`morlock.yml` runs on demand (`gh workflow run morlock.yml`); its nightly 01:00 UTC schedule is disabled — see the note at the top of the workflow. It invokes the Claude Code action seeded with the provider-neutral
Morlock security-probe persona (`.agents/skills/morlock/SKILL.md`). The same role is available through
the Claude Code, Codex, and GitHub Copilot adapters. The agent:

1. Reads and analyses the codebase for security weaknesses.
2. Writes proving tests under `apps/web/integration/security/`.
3. Opens a PR (`morlock/<date>`) and a summary issue.

This is **non-blocking** — it is an antibody generator, not a merge gate.

**Required secret:** `ANTHROPIC_API_KEY`

## Required secrets / variables

| Name                                                 | Required by                | Notes                                                                                                                              |
| ---------------------------------------------------- | -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `ANTHROPIC_API_KEY`                                  | `morlock.yml`              | Claude Code action                                                                                                                 |
| `SEMGREP_APP_TOKEN`                                  | `security.yml`             | Optional — Semgrep runs without it but results won't appear in the Semgrep dashboard                                               |
| `BACKUP_DATABASE_URL` (secret)                       | `backup.yml`               | Production's direct Neon connection string, pooling off                                                                            |
| `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` (secrets) | `backup.yml`               | R2 API token, Object Read & Write on the backup bucket only                                                                        |
| `R2_ACCOUNT_ID`, `R2_BUCKET` (variables)             | `backup.yml`               | Not secret. Variables are not masked in logs                                                                                       |
| `BACKUP_AGE_RECIPIENT` (variable)                    | `backup.yml`               | The age **public** key. The private key never goes to GitHub                                                                       |
| `BACKUPS_ENABLED` (variable)                         | `backup.yml`               | `true` turns backups on; anything else makes every run a green no-op                                                               |
| `NEON_API_KEY` (secret)                              | `neon-preview-cleanup.yml` | A project-scoped Neon API key for the 3moji project. Setup: [owner actions](../owner-actions.md), "Clean up Neon preview branches" |
| `NEON_PROJECT_ID` (variable)                         | `neon-preview-cleanup.yml` | The Neon project ID. Variables are not masked in logs; the script never prints it                                                  |
| `NEON_CLEANUP_ENABLED` (variable)                    | `neon-preview-cleanup.yml` | `true` turns the cleanup on. Anything else, or unset, makes every run a green no-op                                                |

All other secrets (external service URLs, registry credentials) are only needed when you enable the
corresponding features in your project. See comments in `ci.yml` for guidance.

## Local parity

`scripts/verify.sh` runs the same checks as Stage 1 + build, locally. Run it before opening a PR.
The CI and the local script must remain in sync — if you add a check to one, add it to the other.
