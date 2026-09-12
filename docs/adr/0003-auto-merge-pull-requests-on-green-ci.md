# ADR-0003: Auto-merge pull requests once CI passes

**Status:** Accepted
**Date:** 2026-09-11

## Context

This is a solo repository. [ADR-0002](0002-track-work-in-github-issues.md) §5 set the solo merge rule: a PR may merge when CI is green and the AI self-review has no unresolved blocking findings. Someone still has to perform the merge, either the owner or an agent session running `pr-action-review`, so a green PR waits until one of them comes back to it. The owner wants PRs to merge themselves once the tests pass.

GitHub's own tools for this are unavailable. The repository is private on a plan without GitHub Pro: the branch-protection and rulesets APIs return `403 Upgrade to GitHub Pro`, and native auto-merge (`gh pr merge --auto`) depends on required status checks.

Dependabot opens PRs weekly: minor and patch updates grouped into one PR, majors one per package. The five major-version PRs open on 2026-09-11 (NestJS 12, TypeScript 7) all failed CI, and a major can pass the tests while still changing behaviour they do not cover.

A workflow's `GITHUB_TOKEN` has three limits that shape any Actions-based design. Merges and pushes made with it do not trigger `push` or `pull_request` workflows, although `workflow_dispatch` is exempt. It cannot reach a user-owned Project board. Merging a PR that changes `.github/workflows/` needs `actions: write` ([cli/cli#11493](https://github.com/cli/cli/issues/11493)).

## Options considered

| Option                                       | Pros                                                           | Cons                                                                                                                           |
| -------------------------------------------- | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| GitHub Actions merge workflow (chosen)       | No cost; the rules are versioned and unit-tested with the code | Our own code to maintain; nothing stops a manual merge; `GITHUB_TOKEN` limits mean dispatching CI ourselves and no `epic-sync` |
| GitHub Pro, native auto-merge and protection | GitHub enforces required checks and up-to-date branches        | About $4 a month; something still has to arm auto-merge and apply the self-review and Dependabot rules                         |
| Keep merging by hand (`pr-action-review`)    | Nothing new to build                                           | Every merge needs the owner or an open agent session                                                                           |

## Decision

1. We will run `.github/workflows/auto-merge.yml` when a CI run completes, when a PR is labelled `automerge`, and on manual dispatch. It runs `scripts/auto-merge.mjs` from the default branch and never checks out PR code.
2. A PR is merged only when it is open, not a draft, based on `main`, free of merge conflicts, has no reviewer whose latest verdict requests changes, and the newest CI run on its current head commit succeeded. It is squash-merged with the branch deleted, or merged with a merge commit when another open PR is stacked on it.
3. **Opt-in for everyone except Dependabot:** a PR needs the `automerge` label. The `pr` skill adds it only when the AI Pre-Review has no unresolved 🔴 findings, and `pr-action-review` adds it once they are resolved. The AI self-review remains the review gate; this ADR changes who performs the merge, not the rule. Removing the label holds the PR.
4. **Dependabot:** a PR opened by `dependabot[bot]` merges without the label when every update in its commits is `semver-minor` or `semver-patch`. A PR with any major update waits for the owner, who opts it in with the label.
5. **No merging on a stale run:** a green PR that is behind `main` is updated from `main` and CI is dispatched on it; the next green run merges it. After each merge the workflow dispatches CI on `main` and re-evaluates the other open PRs.
6. When a merge or branch update fails, the workflow comments on the PR and the run fails; the PR is left for the owner.

This supersedes ADR-0002 §5 in part: its merge condition stands, and the merge itself is now automatic.

## Consequences

- A PR with a clean self-review, or a Dependabot minor/patch update, merges without anyone returning to it. `pr-action-review` still actions review comments and can merge directly when CI is already green.
- The rules are enforced by a workflow, not by GitHub: anyone with write access can still merge by hand. Moving to GitHub Pro later would allow native protection, and would need a new ADR.
- A PR behind `main` costs an extra CI run for each merge ahead of it, so several queued PRs use more Actions minutes.
- PRs are merged by `github-actions[bot]`. Issues close through `Closes #N` and the board's built-in automation moves them to Done, but `epic-sync` cannot run, so an epic whose last issue auto-merges is synced by hand.
- The decision is unit-tested (`npm run test:scripts`), which adds a `script-tests` job to CI and a step to `scripts/verify.sh`.
- `docs/architecture/system-overview.md` describes the merge gate; `CONTRIBUTING.md`, `AGENTS.md`, `docs/development/github-workflow.md`, `docs/development/ci-cd.md`, and the `pr`, `pr-action-review`, `pr-action-review-mine-loop`, and `dependabot-review` skills were updated to match.

## Related

- Supersedes (in part): [ADR-0002: Track work in GitHub Issues and plan it in versioned documents](0002-track-work-in-github-issues.md), §5
- Issues: #7
- Architecture: [system-overview.md](../architecture/system-overview.md)
