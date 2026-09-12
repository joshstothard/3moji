# Contributing

This repository is worked by a single developer with a coding agent, and tracks work in GitHub Issues on a GitHub Project board. The full conventions are in [docs/development/github-workflow.md](docs/development/github-workflow.md); the decision is [ADR-0002](docs/adr/0002-track-work-in-github-issues.md).

## Branching

- Branch from `main`, always.
- Feature/fix branches: `<issue-number>-<short-description>` — e.g. `42-fix-header-contrast`.
- Chore branches (no issue required): `chore/<short-description>` — e.g. `chore/bump-eslint`.
- Never commit directly to `main`, `staging`, or `production` (the pre-commit hook blocks this).

## Commits

- Conventional Commits format, with the issue number as the scope:
  - `feat(#42): add record comparison table`
  - `fix(#107): debounce search input`
  - `chore: bump prettier to 3.x`
- Keep commits small and focused. One logical change per commit.
- `[skip-adr-sync: reason]` — add to a commit message to bypass the `adr-sync` CI check for an ADR that genuinely has no current-state architecture doc to update (see `AGENTS.md` § ADR reading policy). Keep the reason short but specific.

## Pull Requests

- Run `scripts/verify.sh` before opening any PR. No exceptions.
- Fill the PR template fully: issue, summary, test evidence, risk, rollback.
- Put `Closes #42` in the PR body so GitHub closes the issue when the PR merges. Chores with no issue write `None — chore`.
- Delete `PROGRESS.md` before raising the PR (the `pr` workflow does this).
- **Solo merge rule:** a PR merges once CI is green and the AI self-review posted by `pr` has no unresolved 🔴 findings. GitHub does not let you approve your own PR, so no human approval is required.
- **Auto-merge** ([ADR-0003](docs/adr/0003-auto-merge-pull-requests-on-green-ci.md)): the `pr` skill adds the `automerge` label when the self-review is clean, and the auto-merge workflow squash-merges the PR once CI passes on its up-to-date head commit. Dependabot minor and patch updates merge without the label; majors wait for you. Remove the label to hold a PR. A manual merge is still `gh pr merge <pr> --squash --delete-branch`.
- Stacked PRs: prepend the ⚠️ stacked-PR warning block at the very top of the body, and never squash-merge a stacked chain — use merge commits.

## GitHub setup

One-time, per machine:

```bash
gh auth login                           # sign in to GitHub
gh auth refresh -s project              # allow gh to manage Project boards
gh repo set-default                     # pick your repo (origin) when an upstream remote exists
node scripts/gh-workflow.mjs setup      # create + link the board, set columns, create labels
node scripts/gh-workflow.mjs doctor     # confirm everything is ready
```

The workflow skills keep each issue's board **Status** in sync — Backlog → In Progress → In Review → Done — through `node scripts/gh-workflow.mjs status <number> "<status>"`. No `.env` credentials are needed: `gh` holds them. See [docs/development/github-workflow.md](docs/development/github-workflow.md) for statuses, labels, epics, and sub-issues.

## Architecture Decision Records

- ADRs live in `docs/adr/`, numbered sequentially: `NNNN-<slug>.md`. Draft one with the `adr` skill.
- Accepted ADRs are immutable. To change a decision, write a new ADR and mark the old one `Superseded by ADR-XXXX`.
- An ADR that changes current-state behaviour updates the relevant `docs/architecture/*.md` file in the same PR, or carries `[skip-adr-sync: reason]` (see above).

## Reports

- Reports live in `docs/reports/`, named `YYYY-MM-DD-<slug>.md` — e.g. `2026-09-11-auth-provider-options.md`. Write one with the `report` skill.
- A report answers one question: research into options, a spike's findings, a retrospective, or an audit. It ends with a recommendation and candidate next steps (ADRs to write, workstreams to open).
- A report is a dated snapshot, frozen once its conclusions are acted on. New findings go in a new report that links the old one.

## Workstreams

- Workstreams live in `docs/workstreams/`, named `<slug>.md` — e.g. `checkout-redesign.md`. Scope one with the `workstream` skill.
- A workstream records a goal, scope, phases, and acceptance criteria, and links the reports and ADRs behind it.
- Workstreams are living documents: keep their status, phase table, and issue links current as work lands.
- `plan-work` turns one phase into an `epic` issue with sub-issues on the board; the workstream's phase table links them.

Templates for reports, ADRs, and workstreams are in [`docs/templates/`](docs/templates/).
