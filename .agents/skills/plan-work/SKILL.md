---
name: plan-work
description: "User-invoked only. Turn a workstream phase into an epic issue with sub-issues on the GitHub board"
disable-model-invocation: true
---

Turn one phase of a workstream into GitHub issues: an `epic` issue for the phase, and one sub-issue per PR-sized piece of work, each with acceptance criteria an agent can implement and test against. All issues land in **Backlog** on the board, and the epic and issue numbers are written back into the workstream. Conventions are in [github-workflow.md](../../../docs/development/github-workflow.md).

**Plan input:** use the workstream slug and flags supplied with the skill invocation.

Usage: `plan-work <workstream-slug> [--phase N] [--dry-run]`

- `--phase N` — plan phase `N`. Defaults to the first phase with no epic issue.
- `--dry-run` — stop after presenting the plan (Step 6). Nothing is created on GitHub and no file is changed.

**Every tracker call goes through `scripts/gh-workflow.mjs` or plain `gh issue` commands.** Never hand-write GraphQL. **No PROGRESS.md needed.**

---

## Step 1 — Check the GitHub setup

```bash
node scripts/gh-workflow.mjs doctor
```

If any line shows `✘` (the command exits non-zero), STOP. Show the user the failing lines and the fix each one names (for example `gh auth refresh -s project` or `node scripts/gh-workflow.mjs setup`), and ask them to run it and invoke this skill again.

## Step 2 — Parse the input and read the workstream

- Remove `--phase <N>` (store as `PHASE`) and `--dry-run` (enable **dry-run mode**). The rest is `SLUG`.
- Store today's date as `TODAY` (`date +%F`).
- Read `docs/workstreams/<SLUG>.md` in full. If it does not exist, STOP and list the workstreams in `docs/workstreams/README.md`.
- If the workstream **Status** is `Paused` or `Done`, STOP and ask whether to plan it anyway.

Choose the phase:

- With `--phase N`: that phase. If it does not exist, STOP and list the phases.
- Otherwise: the first row in the Phases table whose **Epic issue** is empty or `—`. If every phase has an epic, STOP: everything is planned. Suggest `workstream <SLUG> --update` to sync progress.

Read the phase subsection in full: outcome, deliverables, acceptance criteria, dependencies, and any issues already listed. Then read what the phase builds on:

- The ADRs and reports in the workstream's **Related** line and **Decision log**.
- The `docs/architecture/*.md` files for the areas the phase touches.
- The code the phase will change, enough to write accurate acceptance criteria and implementation notes.

If the phase depends on a decision that is not made (an ADR that is not yet `Accepted`, or an **Open question** that blocks this phase), STOP and ask whether to plan anyway; suggest the `adr` skill to settle it. An earlier phase that is still in progress does not block planning: note the dependency in the epic and carry on.

## Step 3 — Check for existing issues (idempotency)

A previous run may have been interrupted. Before planning anything new:

1. **Epic already recorded** — if the phase's **Epic issue** cell has a number (only possible with `--phase N`), read it:

   ```bash
   node scripts/gh-workflow.mjs issue <epic-number>
   ```

   Use that epic; do not create another. Its `subIssues` are already planned.

2. **Epic on GitHub but not in the doc** — search for it:

   ```bash
   gh issue list --label epic --state all --search "<phase name> in:title" --json number,title,state,url
   ```

   If an epic for this workstream and phase exists, STOP and ask whether to reuse it. On reuse, read it as in item 1.

3. **Issues already listed** — every `- #<n> <title>` line under the phase's **Issues**, and every sub-issue of a reused epic, is already planned. Do not create them again; show them in the plan as `existing`.

## Step 4 — Break the phase into issues

Plan the issues that, together, meet every acceptance criterion of the phase. Each issue:

- **Title** — imperative mood, specific, under about 70 characters: `Add reminder schedule to check-in API`, not `Reminders` or `Adding reminders`. If the title needs "and", split the issue.
- **Label** — exactly one type: `enhancement` (new user-visible capability), `bug` (broken behaviour), or `task` (refactoring, tooling, docs, infrastructure).
- **Size** — one PR, reviewable in one sitting. Split anything bigger.
- **Order** — by dependency. The first issue has no dependencies inside the phase, so it can be picked up immediately.
- **Body** — the issue shape from `docs/development/github-workflow.md`:

  ```markdown
  ## Context

  <why this issue exists and what it contributes to the phase outcome>

  Part of Phase <N> — <phase name> of the <workstream title> workstream (`docs/workstreams/<SLUG>.md`).
  Related: ADR-<NNNN> (`docs/adr/<NNNN>-<slug>.md`), report `docs/reports/<file>.md`.

  ## Acceptance criteria

  - [ ] <observable behaviour a test can assert>
  - [ ] <...>

  ## Notes

  <implementation hints: files and modules involved, patterns to follow, what is out of scope>

  Blocked by #<n>
  ```

  Drop the `Related:` line if there are no ADRs or reports, and the `Blocked by` line if there are no dependencies. Issue bodies render on GitHub, where repository-relative links do not resolve, so write paths in backticks.

**Acceptance criteria are TDD-friendly:** each is one observable outcome that a failing test can be written for first, e.g. "`POST /okr/check-ins` with a past `remindAt` returns 400" rather than "validation works". Name the test level where it is obvious (unit, integration, e2e). Include the error and edge cases that matter. Avoid criteria that restate the implementation ("uses a Zod schema").

**Coverage check:** map every phase acceptance criterion to at least one issue. If one is not covered, add an issue or tell the user why it is not needed.

Also draft the **epic**:

- **Title:** `<Workstream title>: Phase <N> — <phase name>` (the phase name in the title is what Step 3 searches for).
- **Label:** `epic`.
- **Body:**

  ```markdown
  ## Context

  Phase <N> of the <workstream title> workstream (`docs/workstreams/<SLUG>.md`).
  Related: <ADRs and reports, as above>

  ## Outcome

  <the phase outcome>

  ## Acceptance criteria

  - [ ] <each phase acceptance criterion>

  ## Notes

  Work items are this epic's sub-issues. Depends on: <earlier phase epics or ADRs, or "None">.
  ```

Never invent requirements the workstream, its ADRs, or the user did not state. Where the phase is ambiguous, list the question in the plan instead of guessing.

## Step 5 — Present the plan

Show the epic title, then the issues as a table:

```
Epic: <Workstream title>: Phase <N> — <phase name>

| Order | Title | Label       | Depends on | Acceptance criteria (summary) |
| ----- | ----- | ----------- | ---------- | ----------------------------- |
| 1     | ...   | task        | —          | ...                           |
| 2     | ...   | enhancement | 1          | ...                           |
```

Below the table, show:

- The coverage map: each phase acceptance criterion → the issue order numbers that meet it.
- Issues marked `existing` from Step 3.
- Open questions, if any.

Offer to show the full body of any issue.

## Step 6 — Get approval

**Dry-run mode:** stop here. Tell the user nothing was created or changed, and that running `plan-work <SLUG> --phase <N>` without `--dry-run` creates the issues.

Otherwise ask:

> Create these issues, edit the plan, or stop?

STOP until the user answers.

- **Edit** — apply the changes (retitle, split, merge, reorder, relabel, rewrite criteria), present the plan again, and ask again.
- **Stop** — create nothing.
- **Create** — continue. Only explicit approval counts.

## Step 7 — Create the epic and issues

Write each body to a temporary file, never inline in the shell command:

```bash
PLAN_DIR="$(mktemp -d)"
```

**7a. The epic** (skip if reusing one from Step 3):

```bash
gh issue create --title "<epic title>" --label epic --body-file "$PLAN_DIR/epic.md"
```

`gh issue create` prints the new issue's URL; the number is its last path segment. Store it as `EPIC`.

**7b. Each new issue, in order.** Write its `Blocked by #<n>` lines for dependencies that already have numbers (issues are created in dependency order, so usually all of them):

```bash
gh issue create --title "<title>" --label <enhancement|bug|task> --body-file "$PLAN_DIR/<order>.md"
```

Record the number for each order position.

**7c. Link each issue to the epic:**

```bash
node scripts/gh-workflow.mjs sub-issue <EPIC> <issue-number>
```

**7d. Put everything on the board in Backlog** (each new issue, then the epic):

```bash
node scripts/gh-workflow.mjs status <issue-number> "Backlog"
node scripts/gh-workflow.mjs status <EPIC> "Backlog"
```

**7e. Fill in dependencies now that every number is known.** For any issue whose `Blocked by` line could not be written at creation (a dependency created after it), rewrite the body file with the real numbers and update it:

```bash
gh issue edit <issue-number> --body-file "$PLAN_DIR/<order>.md"
```

Do not assign anyone: the `pickup` skill assigns an issue when work starts.

**If any command fails** (for example a missing label: run `node scripts/gh-workflow.mjs setup`), STOP creating. Tell the user exactly which issues exist so far, and still do Step 8 for those, so running this skill again skips them instead of duplicating them.

## Step 8 — Write the numbers back to the workstream

In `docs/workstreams/<SLUG>.md`:

- **Phases table:** set this phase's **Epic issue** to `#<EPIC>` and **Status** to `Planned`.
- **Phase subsection, Issues:** replace `_Not planned yet._` with one line per issue, in order, keeping any lines already there:

  ```markdown
  - #<n> <title>
  ```

- **Changelog:** append `- <TODAY> — Phase <N> planned: epic #<EPIC>, issues #<first>–#<last>.`

Do not change the workstream **Status**: planning is not starting. In `docs/workstreams/README.md`, set the workstream's **Current phase** to this phase if it was `—`.

## Step 9 — Commit on a branch

Never commit on `main`. Check the current branch:

```bash
git branch --show-current
```

- **`main`, or no branch:** `git switch -c chore/plan-<SLUG>-phase-<N>` (uncommitted changes carry over). Subject: `docs: plan <SLUG> phase <N>`. If the workstream itself is still unmerged on a `chore/workstream-<SLUG>` branch, suggest switching to that branch instead, so the plan ships in the same PR as the workstream.
- **An issue branch (`<issue-number>-<description>`):** stay on it. Subject: `docs(#<issue-number>): plan <SLUG> phase <N>`.
- **Any other branch:** stay on it. Subject: `docs: plan <SLUG> phase <N>`.

Stage only the workstream doc and the index:

```bash
git add docs/workstreams/<SLUG>.md docs/workstreams/README.md
git commit -m "<subject>"
```

If a hook fails, fix the cause and commit again. Never use `--no-verify`. Do not push: the `push` and `pr` skills handle that.

## Step 10 — Report back

Get the board URL:

```bash
node scripts/gh-workflow.mjs project
```

Tell the user:

- The board URL (the `url` field).
- The epic: `#<EPIC> <title>` with its URL.
- The issues as a table: number, title, label, blocked by, URL. Mark any that already existed.
- The workstream doc updated, the branch, and the commit subject.
- The suggested first issue: the lowest-ordered issue with no open blockers, e.g. "Start with `pickup <n>`" (the `pickup` skill).
- To publish the doc update: the `push` or `pr` skill.
