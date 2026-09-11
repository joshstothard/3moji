# ADR-0002: Track work in GitHub Issues and plan it in versioned documents

**Status:** Accepted
**Date:** 2026-09-11

## Context

This repository was adapted from [agentic-workflow-template](https://github.com/GavinGreenwood/agentic-workflow-template) by Gavin Greenwood (MIT), which assumes a team: Jira for tickets, Tempo for time logging, a QA function, and teammates reviewing each other's PRs. It is now used by one developer, pushing to their own private GitHub repository.

The workflow still needs end-to-end traceability (every change starts from a unit of work and closes it on merge), and a way to plan before building: research, decisions, and multi-phase workstreams that turn into actionable work. The template had ADRs but no home for research reports or workstream plans, and its "Proposal → Plan → Tickets" loop had no tooling for the first two steps.

## Decision

1. **Track work in GitHub Issues on a GitHub Project board.** Issues replace Jira tickets; `epic`-labelled issues with sub-issues replace Jira epics; the board's Status field (Backlog → In Progress → In Review → Done) replaces Jira transitions. PRs close issues with `Closes #N`.
2. **Centralise tracker calls in `scripts/gh-workflow.mjs`.** Skills call its subcommands rather than embedding GraphQL, so there is one place to fix when GitHub's API changes.
3. **Add a planning layer of versioned documents:** `docs/reports/` (dated research and retrospectives), `docs/workstreams/` (living plans with phases), alongside the existing `docs/adr/` and a new `docs/architecture/` current-state layer. Four user-invoked skills create them: `report`, `adr`, `workstream`, and `plan-work` (which turns a workstream phase into issues).
4. **Remove team-only workflows:** `log-time` (Tempo), `qa-review-action` (QA function), `pr-review-loop` (reviewing teammates' PRs), and `multi-repo` (parallel team slots).
5. **Solo merge rule:** a PR may merge when CI is green and the AI self-review has no unresolved blocking findings. GitHub does not allow approving your own PR, so no human approval is required.
6. **Scheduled nightly workflows are manual-only** (`workflow_dispatch`) to conserve GitHub Actions minutes on a private repository.

## Consequences

- No Jira or Tempo credentials are needed; `gh auth login` with the `project` scope is the only setup.
- Planning artefacts are reviewed in PRs and versioned with the code they shaped, so an agent can cite a report or workstream as the reason for a change.
- `docs/architecture/` now exists, so `scripts/check-adr-sync.sh` is active: an ADR that changes current-state behaviour must update an architecture doc in the same PR, or carry `[skip-adr-sync: reason]`.
- Pulling future improvements from the upstream template will conflict in the adapted skills; those conflicts resolve in favour of this ADR.
- If the project gains collaborators, `pr-review-loop` and a required-approval merge rule are the first things to restore, via a new ADR.
