# GitHub Issues Workflow

This repository tracks all work in **GitHub Issues** on a **GitHub Project board**, and plans that work in versioned documents under `docs/`. It is set up for a single developer working with a coding agent, pushing to their own GitHub repository. See [ADR-0002](../adr/0002-track-work-in-github-issues.md) for why.

Every skill that touches the tracker goes through one helper, `scripts/gh-workflow.mjs`, so the GitHub plumbing lives in one place.

## One-time setup

```bash
gh auth login                           # sign in to GitHub
gh auth refresh -s project              # allow gh to manage Project boards
node scripts/gh-workflow.mjs setup      # create + link the board, set columns, create labels
node scripts/gh-workflow.mjs doctor     # confirm everything is ready
```

`setup` is idempotent. It creates a board named after the repository (override with `--title`), links it to the repo, sets the Status columns to **Backlog → In Progress → In Review → Done**, and creates the `epic`, `task`, `bug`, and `enhancement` labels. Afterwards, open the board once and switch the view's layout to **Board**.

No `.env` values are required: `gh` holds the credentials. If more than one board is linked to the repo, set `GH_PROJECT_OWNER` and `GH_PROJECT_NUMBER` in `.env` to choose one.

## The planning layer

Work flows from documents to issues to code:

```
report  →  adr  →  workstream  →  plan-work  →  pickup  →  code + tests  →  pr  →  merge
research   decide   scope +       issues on    branch +    gates           Closes #N  board: Done
                    phases        the board    PROGRESS.md
```

| Document               | Lives in                           | Created by   | Mutable?                                               |
| ---------------------- | ---------------------------------- | ------------ | ------------------------------------------------------ |
| Report                 | `docs/reports/YYYY-MM-DD-<slug>.md` | `report`     | Frozen once its conclusions are acted on               |
| ADR                    | `docs/adr/NNNN-<slug>.md`          | `adr`        | **Immutable** once Accepted (status line only)         |
| Workstream             | `docs/workstreams/<slug>.md`       | `workstream` | Living: status, phases, and issue links are kept current |
| Architecture (current) | `docs/architecture/*.md`           | `adr`, any PR | Living: always describes what is true now               |
| Issue                  | GitHub                             | `plan-work`, `capture` | Closed by the PR that implements it           |

Templates for the three planning documents are in [`docs/templates/`](../templates/).

- **Reports** answer a question: research into options, a spike's findings, a retrospective, an audit. They end with a recommendation and candidate next steps (ADRs to write, workstreams to open).
- **ADRs** record one decision and its trade-offs. They reference the report that informed them.
- **Workstreams** turn a goal into phases with acceptance criteria. Each phase becomes an `epic` issue with sub-issues; the workstream's phase table links them.
- **Issues** are the unit of work. Each has acceptance criteria an agent can implement and test against.

## Issues

| Concept           | Convention                                                                    |
| ----------------- | ----------------------------------------------------------------------------- |
| Unit of work      | An issue, referenced as `#42`                                                 |
| Type              | Label: `bug`, `enhancement` (feature), or `task`                              |
| Epic              | An issue labelled `epic`; its work items are **sub-issues**                   |
| Owner             | Assignee (`gh issue edit 42 --add-assignee @me`)                             |
| Acceptance criteria | A `## Acceptance criteria` checklist in the issue body                      |
| Discussion        | Issue comments (`gh issue comment 42 --body-file <file>`)                      |

Issue body shape (used by `capture` and `plan-work`):

```markdown
## Context

<why this matters; link the workstream, ADR, or report>

## Acceptance criteria

- [ ] <observable, testable outcome>

## Notes

<implementation hints, out-of-scope items, dependencies such as "Blocked by #12">
```

## Board statuses

| Status          | Meaning                        | Set by                                                        |
| --------------- | ------------------------------ | ------------------------------------------------------------- |
| **Backlog**     | Filed, not started             | `plan-work`, `capture` (for work not yet done)                |
| **In Progress** | Assigned and being built       | `pickup`                                                      |
| **In Review**   | PR open, CI and review running | `pr`                                                          |
| **Done**        | PR merged, issue closed        | `pr-action-review` after merge (GitHub's built-in board automation also does this) |

Set a status with:

```bash
node scripts/gh-workflow.mjs status 42 "In Progress"
```

The command adds the issue (or PR) to the board if it is not already there. Read an issue with its parent, sub-issues, linked PRs, comments, and board status with:

```bash
node scripts/gh-workflow.mjs issue 42
```

Link a sub-issue to its epic with:

```bash
node scripts/gh-workflow.mjs sub-issue <epic-number> <issue-number>
```

## Branches, commits, and PRs

- Branch: `<issue-number>-<short-description>`, e.g. `42-add-shell-app`. Chores with no issue: `chore/<short-description>`.
- Commit: Conventional Commits with the issue number as the scope, e.g. `feat(#42): add shell app route`.
- PR body: `Closes #42`. GitHub closes the issue when the PR merges into `main`.
- Merge: squash-merge with `gh pr merge <pr> --squash --delete-branch` once CI is green and review findings are resolved. As the only developer you cannot approve your own PR on GitHub, so the AI self-review from `pr` is the review gate.

## Pushing changes

`main` is protected by the pre-commit hook, so every change goes through a branch and a PR:

```bash
git switch -c 42-add-shell-app
# ...work, commit...
git push -u origin HEAD          # the pre-push hook runs format, lint, typecheck, tests
gh pr create --fill              # or run the pr skill, which fills the template
gh pr merge --squash --delete-branch
```

The `push` and `pr` skills run the same steps with the full verification suite first.

## Pulling template updates

The template this repo was adapted from is kept as the `upstream` remote. To see and bring in improvements:

```bash
git fetch upstream
git log --oneline main..upstream/main
git switch -c chore/sync-upstream && git merge upstream/main
```

Expect conflicts in the skills and docs changed by this adaptation; resolve them in favour of the GitHub Issues workflow.
