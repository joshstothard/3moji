---
name: workstream
description: "User-invoked only. Scope a body of work into a workstream doc: goal, scope, phases, acceptance criteria"
disable-model-invocation: true
---

Scope a body of work into a workstream document in `docs/workstreams/`: the goal, why now, scope and non-goals, measurable success criteria, and phases that each deliver something demonstrable. The `plan-work` skill later turns each phase into an epic issue with sub-issues. See [github-workflow.md](../../../docs/development/github-workflow.md#the-planning-layer) for where workstreams sit in the planning layer.

**Workstream input:** use the name and flags supplied with the skill invocation.

Usage:

- `workstream <name>` — **create mode**: interview, draft, and write a new workstream.
- `workstream <slug> --update` — **update mode**: sync an existing workstream's phase and issue status from GitHub, and apply any changes the user asks for.

**No PROGRESS.md needed.** A workstream is a plan, not an implementation session.

---

## Step 1 — Parse the input

- If `--update` is present, remove it and use **update mode** (skip to Step U1). Otherwise use **create mode**.
- The rest is the name. Derive `SLUG`: 2-5 lowercase kebab-case words naming the outcome, e.g. `okr-check-in-reminders`.
- Store today's date as `TODAY` (`date +%F`).

---

**Create mode: Steps 2-7, then Steps 8-9.**

## Step 2 — Check it does not already exist

```bash
ls docs/workstreams
```

- If `docs/workstreams/<SLUG>.md` exists, STOP and ask whether the user meant `workstream <SLUG> --update`.
- If another workstream in the index in `docs/workstreams/README.md` covers overlapping ground, point it out and ask whether this should be a new phase there instead.

## Step 3 — Gather context

Read before asking anything, so the interview can propose sensible defaults:

- The conversation so far.
- Reports and ADRs the user mentioned, or that match the topic:

  ```bash
  grep -ril "<key term>" docs/reports docs/adr docs/architecture
  ```

  Read the matching reports' **Recommendation** and **Next steps**, and the architecture docs for the areas involved.

- Open issues that may already cover part of the work:

  ```bash
  gh issue list --state open --search "<key term>" --limit 30
  ```

## Step 4 — Interview the user

Ask **one batch** of questions, each with a proposed answer drawn from Step 3, so the user can accept most of them with a single reply:

```
I've drafted answers from <sources>. Reply "ok" to accept them all, or correct any by number.

1. Goal — <proposed: the outcome in one or two sentences>
2. Why now — <proposed>
3. In scope — <proposed bullets>
4. Non-goals — <proposed bullets>
5. Success criteria — <proposed, each measurable: a number, a passing check, or an observable behaviour>
6. Constraints — <proposed: deadlines, tech choices already made (cite ADRs), budget, dependencies>
7. Target date — <proposed, or "none">
```

STOP until the user answers. Ask one follow-up batch only if the answers conflict or a success criterion is still not measurable.

## Step 5 — Draft the phases

Break the work into phases. Each phase:

- **Delivers something demonstrable**: a user can see it, a check passes, or a behaviour can be shown. Prefer thin end-to-end slices over layers ("API then UI" is two phases nobody can demo alone).
- **Is small**: roughly 3-8 issues, each one PR. Split a phase that needs more; merge one that needs fewer than three unless it is deliberately a spike.
- **Has acceptance criteria**: observable and testable, so `plan-work` can turn them into issues and a reviewer can check them off.
- **Names its dependencies**: earlier phases, ADRs that must be accepted first, and external factors.

Put the riskiest unknown or the thinnest end-to-end slice in Phase 1. If a phase depends on a decision that has not been made, list it under **Open questions** and plan to suggest the `adr` skill.

Also draft **Approach**, **Risks & mitigations**, and **Open questions**. Do not create any issues: the **Epic issue** column stays `—` and each phase's **Issues** list stays `_Not planned yet._` until `plan-work` runs.

## Step 6 — Review with the user

Show the user the goal, success criteria, the Phases table, and each phase's outcome, acceptance criteria, and dependencies. Ask:

> Approve this workstream, amend it, or stop? And is work starting now (Active) or is this a proposal for later (Proposed)?

STOP until the user answers.

- **Amend** — apply the changes, show the draft again, and ask again.
- **Stop** — write nothing.
- **Approve** — continue.

## Step 7 — Write the workstream

Create `docs/workstreams/<SLUG>.md` from [`docs/templates/workstream.md`](../../../docs/templates/workstream.md):

- **Status** `Proposed`, or `Active` only if the user confirmed work is starting now. **Owner** is `git config user.name`. **Started** is `TODAY`. **Target** is the answer to question 7.
- **Related** links the reports and ADRs from Step 3.
- Every phase has a row in the Phases table (status `Not planned`) and a `### Phase N — <name>` subsection.
- **Decision log** gets a line for each decision already made during scoping, linking its ADR where one exists. Delete the placeholder line if there are none.
- **Changelog** starts with `- <TODAY> — Created (<Status>).`
- Delete the template's HTML comments and any placeholder you did not fill.

Add a row to the index table in `docs/workstreams/README.md`, where `<workstream-file>` is the filename `<SLUG>.md`:

```markdown
| [<Workstream title>](./<workstream-file>) | <Status> | — | <Target> |
```

For each report in **Related**, add the workstream to that report's **Follow-ups** cell in `docs/reports/README.md`. If a report is still `Draft`, set its **Status** to `Final` in the report header and the index row: its conclusions are now acted on.

Then go to Step 8.

---

**Update mode: Steps U1-U4, then Steps 8-9.**

## Step U1 — Read the workstream

Read `docs/workstreams/<SLUG>.md` in full. If it does not exist, STOP and list the workstreams in `docs/workstreams/README.md`.

## Step U2 — Sync status from GitHub

For each phase with an epic in the **Epic issue** column:

```bash
node scripts/gh-workflow.mjs issue <epic-number>
```

From the JSON, read the epic's `state`, and each entry in `subIssues` (`number`, `title`, `state`). For issues that are open, check their board column with `node scripts/gh-workflow.mjs issue <number>` (`boardStatus`) when it matters for the phase status.

Derive each phase's status:

| Phase status | When                                                                |
| ------------ | ------------------------------------------------------------------- |
| Not planned  | No epic issue                                                       |
| Planned      | Epic exists; every sub-issue is open and in **Backlog**             |
| In progress  | At least one sub-issue is closed, **In Progress**, or **In Review** |
| Done         | The epic and every sub-issue are closed                             |

Then reconcile each phase's **Issues** list with the epic's sub-issues:

- A closed issue's line becomes `- #<n> <title> — done`.
- A sub-issue on GitHub that is missing from the list (for example, added later with the `capture` skill) is appended to the list.
- An issue in the list that is not a sub-issue of the epic is flagged to the user. Offer to link it with `node scripts/gh-workflow.mjs sub-issue <epic> <n>`; do not remove it from the list on your own.

## Step U3 — Apply the user's changes

If the user asked for changes (a new phase, changed scope, a revised target, pausing the workstream), draft them and show the diff. STOP for approval before writing. New phases get status `Not planned` and no issues.

Propose, but do not apply without the user's confirmation:

- **Proposed → Active** when any phase is `In progress`.
- **Active → Done** when every phase is `Done`. Ask the user to confirm each **Success criteria** item is met, and tick the ones that are.
- **Paused** only when the user asks for it; record why in the changelog.

**Never rewrite history.** Do not edit or remove existing **Decision log** or **Changelog** entries; only append. A reversed decision gets a new Decision log line (and usually a new ADR through the `adr` skill).

## Step U4 — Write the update

Update the header **Status**, the Phases table, the phase **Issues** lists, and tick acceptance criteria whose issues are all done. Append one **Changelog** line summarising the sync, e.g.:

```markdown
- <TODAY> — Synced from GitHub: Phase 1 Done (epic #12 closed); Phase 2 In progress (2 of 5 issues done).
```

Update the workstream's row in `docs/workstreams/README.md`: **Status**, **Current phase** (the lowest-numbered phase that is not `Done`, e.g. `2 — <name>`, or `—` when all are done), and **Target**.

If nothing changed, say so, write nothing, and skip to Step 9.

---

## Step 8 — Commit on a branch

Never commit on `main`. Check the current branch:

```bash
git branch --show-current
```

- **`main`, or no branch:** `git switch -c chore/workstream-<SLUG>` (uncommitted changes carry over).
- **An issue branch (`<issue-number>-<description>`):** stay on it and use `docs(#<issue-number>): ...` as the subject prefix.
- **Any other branch:** stay on it.

Subject: `docs: add <SLUG> workstream` (create mode) or `docs: update <SLUG> workstream` (update mode).

Stage only the files this skill changed:

```bash
git add docs/workstreams/<SLUG>.md docs/workstreams/README.md <docs/reports/README.md and reports, if changed>
git commit -m "<subject>"
```

If a hook fails, fix the cause and commit again. Never use `--no-verify`. Do not push: the `push` and `pr` skills handle that.

## Step 9 — Report back

Tell the user:

- The workstream path and its status.
- **Create mode:** the phases in one line each (name and outcome), and the open questions.
- **Update mode:** what changed: phase statuses, issues marked done, issues appended or flagged, and the changelog line. Or that everything was already current.
- The branch and commit subject, if a commit was made.
- What next:
  - an open question that needs a decision → the `adr` skill
  - a phase ready to break into issues → the `plan-work` skill, e.g. `plan-work <SLUG> --phase 1`
  - to publish → the `push` or `pr` skill
