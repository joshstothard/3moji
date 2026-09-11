---
name: pickup
description: "User-invoked only. Assign the issue, read it fully, brief the work, create the branch, start PROGRESS.md"
disable-model-invocation: true
---

Pick up a GitHub issue: assign it to me, move it to In Progress on the board, read it fully with its parent epic, sub-issues, and linked context, then prepare to implement.

Conventions (board statuses, branch and commit format) are defined in [docs/development/github-workflow.md](../../../docs/development/github-workflow.md).

**Issue input:** use the value and flags supplied with the skill invocation.

Usage: `pickup <issue> [--stay]`

- `<issue>` — `42`, `#42`, or an issue URL.
- `--stay` — do **not** create a new branch. Stay on the current branch and do the work there. Use this when stacking multiple issues on one branch.

---

## Step 0 — Parse arguments and normalise the issue number

Split the invocation input into the issue reference and any flags:

- If `--stay` is present anywhere in the invocation input, enable **stay mode** and remove the flag before normalising. Stay mode changes Steps 9 and 10 only — all GitHub steps run unchanged.
- Normalise the remaining issue reference: strip a leading `#`; for a URL such as `https://github.com/<owner>/<repo>/issues/42`, take the number after `/issues/`. If the URL's `<owner>/<repo>` is not this repository (compare with `gh repo view --json nameWithOwner`), stop and tell the user.
- Store the cleaned issue number as `ISSUE_NUMBER`. Use `ISSUE_NUMBER` for all subsequent steps.

## Step 1 — Check GitHub access

No `.env` values are needed: `gh` holds the credentials. If any `gh` or `node scripts/gh-workflow.mjs` call below fails with an authentication, scope, repository, or board error, run:

```bash
node scripts/gh-workflow.mjs doctor
```

Stop and tell the user the fix it prints for each failing check (e.g. `gh auth refresh -s project`, or `node scripts/gh-workflow.mjs setup`). Do not retry until they confirm it is fixed.

## Step 2 — Fetch the issue

```bash
node scripts/gh-workflow.mjs issue <ISSUE_NUMBER>
```

Parse the JSON and extract:

- `viewer` (your GitHub login)
- `title`
- `body` (full markdown — Context / Acceptance criteria / Notes)
- `state`
- `assignees` (may be empty)
- `boardStatus`
- `labels` (type: `bug` / `enhancement` / `task`)
- `milestone`
- `parent` (if present — usually the epic; includes its own `parent`, the grandparent)
- `subIssues`
- `linkedPullRequests`
- `comments`

If `state` is `CLOSED`, stop and tell the user: "#<ISSUE_NUMBER> is closed — do you want to reopen it (`gh issue reopen <ISSUE_NUMBER>`) and pick it up, or did you mean a different issue?" Do not proceed until the user confirms.

## Step 2a — Check epic assignment

Check the fetched issue data:

- If `parent` is set, check whether it is an epic:
  ```bash
  gh issue view <parent-number> --json labels --jq '[.labels[].name]'
  ```
  If the parent is labelled `epic`, the epic is set → continue to Step 3. If the parent is an ordinary issue, check the grandparent (`parent.parent`) the same way; if that is an `epic`, the epic is set → continue to Step 3.
- If there is no parent, or no `epic` in the chain → note this in the brief (Step 8) as an open question — "No parent epic: run the `assign-epic` skill for #<ISSUE_NUMBER>, or confirm it is intentionally standalone" — then continue.

## Step 3 — Assignee safety check

- If `assignees` is **empty** (unassigned) → proceed.
- If `assignees` contains only `viewer` → proceed.
- If `assignees` contains **anyone other than `viewer`** → STOP. Output: "#<ISSUE_NUMBER> is assigned to @<login> — are you sure you want to pick this up?" Do not proceed until the user confirms. When they confirm, also ask whether to remove the other assignee (`gh issue edit <ISSUE_NUMBER> --remove-assignee <login>`); only remove on an explicit yes.

## Step 4 — Assign the issue to me

```bash
gh issue edit <ISSUE_NUMBER> --add-assignee @me
```

## Step 5 — Move to In Progress

This must be the **last** tracker write, so nothing can clobber the status afterwards. The helper adds the issue to the board first if it is not already there, then sets the status, so no separate board step is needed:

```bash
node scripts/gh-workflow.mjs status <ISSUE_NUMBER> "In Progress"
```

Then confirm the status actually landed (a successful command only means the request was accepted): fetch the issue again and check that its `boardStatus` entry for the workflow board reads "In Progress":

```bash
node scripts/gh-workflow.mjs issue <ISSUE_NUMBER>
```

If the issue has a parent epic (Step 2a), move the epic out of Backlog now that work on it has started. The command is a no-op when the epic is already in progress or the issue has no epic:

```bash
node scripts/gh-workflow.mjs epic-sync <ISSUE_NUMBER>
```

## Step 6 — Fetch all sub-issues

For each entry in `subIssues`, fetch the full issue:

```bash
node scripts/gh-workflow.mjs issue <sub-issue-number>
```

Read and summarise each sub-issue's title, body, state, and board status.

## Step 7 — Fetch parent/epic, pull request, and planning context

- **Parent/epic:** if the issue has a `parent`, fetch it with `node scripts/gh-workflow.mjs issue <parent-number>` to understand the broader epic. If `parent.parent` (the grandparent) is set, fetch that as well.
- **Linked pull requests:** `linkedPullRequests` lists PRs that close this issue. An open or merged one means work already exists — note it in the brief, and raise it as an open question if it is open.
- **Referenced issues:** GitHub has no typed issue links, so related issues appear in the body or comments (e.g. "Blocked by #12"). For each, fetch `gh issue view <number> --json number,title,state`. An open blocker is an open question.
- **Workstream:** if the issue body (or its epic's body) links a document under `docs/workstreams/`, read it — at least the phase this issue belongs to — and name it in the brief. Do the same for any linked ADR (`docs/adr/`) or report (`docs/reports/`).

## Step 8 — Output a brief

Print a structured briefing so the work is clear before any code is written:

```
## Issue: #<ISSUE_NUMBER> — <title>

**Type:** <bug|enhancement|task label, or "unlabelled">
**Milestone:** <milestone — omit if none>
**Status:** → In Progress (just moved)
**Parent epic:** <#number — title, or "none (see open questions)">
**Workstream:** <docs/workstreams/<slug>.md and phase — include this line only when the issue or its epic links one; omit otherwise>
**Branch (stay mode only):** <current branch — include this line only when `--stay` is active; omit otherwise>

### Description
<issue body: Context and Notes>

### Acceptance criteria
<checklist from the issue body — if there is none, say so and list it under open questions>

### Sub-issues
- [ ] #<number>: <title> (<state / board status>)
...

### Linked pull requests
- #<number> — <title> (<state>)
...

### Referenced issues
- <relationship, e.g. Blocked by>: #<number> — <title> (<state>)
...

### Implementation notes
<what needs to be built, based on reading the issue and relevant docs>

### Open questions
<anything unclear that needs resolving before coding starts>
```

## Step 9 — Create the feature branch (skipped in stay mode)

**If stay mode (`--stay`) is active:**

- Run `git branch --show-current` to check the current branch.
- If the current branch is `main` (or empty/detached), **STOP** and tell the user: "You are on `main`. The `--stay` flag is for continuing work on an existing feature branch. Rerun without `--stay` to create a new branch, or switch to the feature branch first."
- Otherwise: do **not** switch branches, do **not** switch to main, do **not** create a new branch. All work happens on the current branch.
- Every commit for this issue must reference the **new** issue number as its scope (e.g. `feat(#<ISSUE_NUMBER>): ...`), even though the branch name references a different issue.
- Skip to Step 10.

**Otherwise**, following the naming conventions in CONTRIBUTING.md and `docs/development/github-workflow.md`, create and switch to a new branch from `main`:

```bash
git switch main && git pull && git switch -c <ISSUE_NUMBER>-<short-description>
```

Use the issue number and a 2–4 word kebab-case description derived from the title, e.g. `42-add-shell-app`. Commits on this branch use `<type>(#<ISSUE_NUMBER>): <description>`.

## Step 10 — Initialise PROGRESS.md

Create a `PROGRESS.md` file in the repo root as the session scratchpad (per AGENTS.md). Seed it with the issue context so the session log starts with a clear baseline:

```markdown
# PROGRESS.md — #<ISSUE_NUMBER>: <title>

**Issue:** <issue url>
**Branch:** <branch-name>
**Started:** <today's date>

## Plan

<high-level implementation approach derived from the issue brief>

## Progress

_Nothing logged yet._

## Decisions

_None yet._

## Open Questions

<carry over any open questions from the Step 8 brief>
```

**If stay mode (`--stay`) is NOT active:** create `PROGRESS.md` fresh. If one already exists (leftover from a previous session), read it first, then overwrite it with the new session header — do not append to stale content.

**If stay mode (`--stay`) is active and a `PROGRESS.md` already exists**, it belongs to the branch's ongoing work — do **not** overwrite it. Instead, append a new issue section to the end:

```markdown
---

# #<ISSUE_NUMBER>: <title> (stacked on this branch)

**Issue:** <issue url>
**Branch:** <current branch>
**Started:** <today's date>

## Plan

<high-level implementation approach derived from the issue brief>

## Progress

_Nothing logged yet._

## Decisions

_None yet._

## Open Questions

<carry over any open questions from the Step 8 brief>
```

**If stay mode (`--stay`) is active and `PROGRESS.md` does NOT exist**, create it fresh using the standard template above (same as non-stay mode).

---

After the briefing is output, the branch is created (or confirmed, in stay mode), and PROGRESS.md is initialised (or appended to), pause and ask: "Ready to start — any questions before I begin?" Wait for the user's go-ahead before writing any code.
