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
  │     e2e (Playwright + postgres + redis services)
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

| File                                     | Trigger                                                         | Purpose                  |
| ---------------------------------------- | --------------------------------------------------------------- | ------------------------ |
| `.github/workflows/ci.yml`               | PR, push to `main`, `workflow_dispatch`                         | Full pipeline            |
| `.github/workflows/auto-merge.yml`       | CI run completed, PR labelled `automerge`, `workflow_dispatch`  | Merge PRs once CI passes |
| `.github/workflows/security.yml`         | `workflow_call`, `workflow_dispatch`                            | Reusable security job    |
| `.github/workflows/nightly-security.yml` | `workflow_dispatch` only (daily 06:00 UTC schedule disabled)    | Calls `security.yml`     |
| `.github/workflows/nightly-mutation.yml` | `workflow_dispatch` only (weekdays 02:00 UTC schedule disabled) | Stryker mutation testing |
| `.github/workflows/morlock.yml`          | `workflow_dispatch` only (nightly 01:00 UTC schedule disabled)  | Morlock security probe   |

### Scheduled workflows are manual-only

Per [ADR-0002](../adr/0002-track-work-in-github-issues.md), the nightly workflows keep their `schedule:` blocks commented out to conserve GitHub Actions minutes on a private repository. Run them from the repository's **Actions** tab, or from the command line:

```bash
gh workflow run nightly-security.yml
gh workflow run nightly-mutation.yml
```

To restore a schedule, uncomment its `schedule:` block. `morlock.yml` was already manual-only for a separate reason recorded in the workflow file (scheduled runs were being rejected by the Anthropic API); follow that note before re-enabling it. `security.yml` still runs as a blocking stage of `ci.yml` on every PR, so audit regressions are caught without the nightly run.

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

**`GITHUB_TOKEN` side effects.** A merge or branch update made with `GITHUB_TOKEN` does not trigger `push` or `pull_request` workflows, so the script dispatches `ci.yml` itself (`workflow_dispatch` is exempt): on `main` after every merge, and on the PR branch after an update. After a merge it re-evaluates the other open PRs, so any left behind `main` are updated.

The exemption covers the dispatch itself and nothing downstream of it. Measured on 2026-09-13: a CI run that auto-merge dispatched on a PR branch (`34742611694`, completed 06:28:00) started no Auto-merge run, and neither did `34742068590` on another branch (completed 06:15:06), while every human-triggered CI completion that day did start one within two seconds. The `workflow_run` event raised by a `GITHUB_TOKEN`-started run is suppressed just like a `push` event would be, so no later run can be relied on to evaluate a PR the gate updated — on #128 one sat green, labelled and mergeable for over ten minutes ([#58](https://github.com/joshstothard/3moji/issues/58)).

**So the run that updates a branch finishes the job itself.** After dispatching CI on the new head it polls every 15 seconds until that run completes, then evaluates the PR again through exactly the same rules as above, and merges only if they all hold on the head as it is then. The dispatch API returns no run id, so the dispatched run is recognised as a `workflow_dispatch` run at the new head created no earlier than the dispatch; completion only ends the wait, and the verdict is still read from every run at the head, as above. If `main` moved during the wait, the PR is updated and waited on once more, and after two updates it is skipped (`behind-main-after-update`). The run's waiting is capped at 20 minutes across every PR it evaluates (CI takes about five), with the job's `timeout-minutes` at 30 above that. When the budget runs out, a PR still waiting is skipped with `ci-still-running-after-update`, and a PR not yet updated is left alone once less than 6 minutes remain (`wait-budget-spent`) rather than updated with nothing left to see its CI through. Neither is a failure: the next run evaluates the PR again, and `gh workflow run auto-merge.yml -f pr=<number>` does so on demand. **Do not remove this wait, and do not replace it with a trigger** — every event downstream of the gate's own writes is suppressed. The workflow's `actions: write` permission covers the dispatch, and is also what lets `GITHUB_TOKEN` merge a PR that changes files under `.github/workflows/`. `GITHUB_TOKEN` cannot reach the user-owned Project board, so `epic-sync` does not run for auto-merged PRs; issues still close through `Closes #N` and the board's built-in automation moves them to Done. When an epic's last issue auto-merges, run `node scripts/gh-workflow.mjs epic-sync <issue-number>`.

**When it cannot merge:** a failed merge or branch update is posted as a comment on the PR, and the run fails so it shows in the Actions tab. Merge by hand with `gh pr merge <number> --squash --delete-branch`.

**Holding a PR:** remove the `automerge` label, or convert the PR to a draft (`gh pr ready <number> --undo`). A Dependabot minor or patch PR has no label to remove, so convert it to a draft or close it.

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

**Current overrides and why they exist:**

| Package       | Pinned to | Root cause                                                                                                                                     | Still needed?                                                                                                  |
| ------------- | --------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `picomatch@2` | `2.3.2`   | `anymatch` (via `jest-haste-map`) and `micromatch` (via `@next/eslint-plugin-next` → `fast-glob`); ReDoS GHSA-c2c7-rcm5-vvqj, fixed in `2.3.2` | **Yes** — `anymatch` declares `^2.0.4`, so the pin is what guarantees the patched floor                        |
| others        | —         | see `overrides` in root `package.json`                                                                                                         | Not re-examined in [#43](https://github.com/joshstothard/3moji/issues/43); no consumer changed with `apps/api` |

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

| Name                | Required by    | Notes                                                                                |
| ------------------- | -------------- | ------------------------------------------------------------------------------------ |
| `ANTHROPIC_API_KEY` | `morlock.yml`  | Claude Code action                                                                   |
| `SEMGREP_APP_TOKEN` | `security.yml` | Optional — Semgrep runs without it but results won't appear in the Semgrep dashboard |

All other secrets (external service URLs, registry credentials) are only needed when you enable the
corresponding features in your project. See comments in `ci.yml` for guidance.

## Local parity

`scripts/verify.sh` runs the same checks as Stage 1 + build, locally. Run it before opening a PR.
The CI and the local script must remain in sync — if you add a check to one, add it to the other.
