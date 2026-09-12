# Workstreams

A workstream turns a goal into phases with acceptance criteria. Each phase becomes an `epic` issue with sub-issues on the GitHub Project board, and the workstream links back to them, so the plan and the board stay traceable to each other. See [the planning layer](../development/github-workflow.md#the-planning-layer) for where workstreams sit in the workflow.

## What belongs here

A body of work that is too big for a single issue: several PRs, usually several phases, with a goal you can check off. A workstream records the goal, why now, scope and non-goals, measurable success criteria, the phases, risks, open questions, and a log of decisions and changes.

What does **not** belong here: research and option comparisons (a report in [`docs/reports/`](../reports/)), a single decision and its trade-offs (an ADR in [`docs/adr/`](../adr/)), and work small enough for one issue (use the `capture` skill).

## Naming

`<slug>.md`, 2-5 kebab-case words naming the outcome, e.g. `okr-check-in-reminders.md`. No date: a workstream is a living document, and its header records when it started.

## How workstreams are created and planned

1. The [`workstream`](../../.agents/skills/workstream/SKILL.md) skill interviews you, drafts the phases from [`docs/templates/workstream.md`](../templates/workstream.md), writes the doc, and adds it to the index below.
2. The [`plan-work`](../../.agents/skills/plan-work/SKILL.md) skill turns one phase into an epic issue with sub-issues, then writes the epic and issue numbers back into the doc.
3. Running the `workstream` skill with `--update` syncs phase and issue status from GitHub and appends to the changelog.

## Lifecycle

| Status   | Meaning                                                            |
| -------- | ------------------------------------------------------------------ |
| Proposed | Drafted and approved as a plan; work has not started               |
| Active   | Work is under way                                                  |
| Paused   | Deliberately on hold; the changelog says why                       |
| Done     | Success criteria met; the doc stays as the record of what was done |

Each phase moves **Not planned → Planned → In progress → Done**. The document is living: status, phases, and issue links are kept current, but the **Decision log** and **Changelog** are append-only.

## Index

<!-- One row per workstream, active first. Maintained by the workstream and plan-work skills. -->

| Workstream                  | Status | Current phase                | Target |
| --------------------------- | ------ | ---------------------------- | ------ |
| [3moji MVP](./3moji-mvp.md) | Active | 1 — Foundation and providers | None   |
