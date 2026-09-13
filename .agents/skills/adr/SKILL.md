---
name: adr
description: "User-invoked only. Draft a numbered Architecture Decision Record from the conversation, and sync the architecture docs"
disable-model-invocation: true
---

Record one decision as a numbered Architecture Decision Record in `docs/adr/`, keep `docs/architecture/` true to it, and link it from the report and workstreams it relates to.

**ADR input:** use the title and flags supplied with the skill invocation.

Usage: `adr <title> [--supersedes NNNN] [--from-report <path>]`

- `<title>` — the decision in a few words, e.g. `Use Postgres for persistence`.
- `--supersedes NNNN` — this ADR replaces an earlier one, in whole or in part.
- `--from-report <path>` — draft from a report in `docs/reports/` (its options, findings, and recommendation).

**Rules that do not bend:**

- An ADR is **immutable once Accepted**. The only edit ever made to an Accepted ADR is its status line plus a one-line pointer when it is superseded (see Step 8). Changing a decision means a new ADR.
- An ADR that changes current-state behaviour updates `docs/architecture/*.md` in the same PR. `scripts/check-adr-sync.sh` fails CI otherwise (see `AGENTS.md` § ADR reading policy).
- Status becomes `Accepted` only when the user explicitly accepts the draft.

**No PROGRESS.md needed.**

---

## Step 1 — Parse the input

- Remove `--supersedes <NNNN>` and store it as `SUPERSEDES` (zero-pad to 4 digits).
- Remove `--from-report <path>` and store it as `REPORT`. If the file does not exist, STOP and list `docs/reports/`.
- The rest is the title. Write it in sentence case. Derive `SLUG`: lowercase kebab-case of the title, e.g. `use-postgres-for-persistence`.
- Store today's date as `TODAY` (`date +%F`).

## Step 2 — Gather context

Read, in this order:

1. The conversation so far: the problem, the options discussed, the choice made, and why.
2. `REPORT`, if given, in full: especially **Options**, **Recommendation**, and **Next steps**.
3. The `docs/architecture/*.md` files for the areas the decision touches. They describe what is true now.
4. If `SUPERSEDES` is set, that ADR in full. If it is not `Accepted` (for example it is already superseded), STOP and ask how to proceed.
5. Workstreams the decision relates to:

```bash
grep -ril "<key term>" docs/workstreams
grep -rl "<report filename>" docs/workstreams
```

Check the decision is not already recorded:

```bash
grep -il "<key term>" docs/adr/*.md
```

If an Accepted ADR already covers it, STOP: point to it and ask whether this should supersede it instead.

**If no decision has actually been made** (options are still open, or the conversation ends without a choice), STOP. An ADR records a decision, not a debate. Offer the choice back to the user, or suggest the `report` skill if the options need research first.

## Step 3 — Number the ADR

Never number from the local `docs/adr` folder. A branch cut before another ADR merged sees a stale folder, and two branches open at once then take the same number. ADR-0003 reached `main` twice that way, and the repair meant editing an Accepted ADR (#35, #36).

Take the number from `origin/main`, freshly fetched, and from the ADR files that **open** pull requests add. Run this as one command:

```bash
(
  set -euo pipefail
  git fetch --quiet origin main ||
    { echo "STOP: cannot fetch origin/main. Refusing to number from the local docs/adr, which may be stale." >&2; exit 1; }
  merged=$(git ls-tree --name-only origin/main docs/adr/ | sed -n 's|^docs/adr/\([0-9]\{4\}\)-.*|\1|p' | sort | tail -1)
  claimed=$(gh pr list --state open --limit 1000 --json number,files \
    --jq '.[] | .number as $pr | .files[].path | select(test("^docs/adr/[0-9]{4}-")) | "\(.[9:13]) #\($pr) \(.)"') ||
    { echo "STOP: cannot list open pull requests. Refusing to guess which numbers they claim." >&2; exit 1; }
  echo "Highest ADR on origin/main: ${merged:-none}"
  echo "ADR files in open pull requests: ${claimed:-none}"
  highest=$(printf '%s\n' "${merged:-0000}" $(printf '%s\n' "$claimed" | cut -d' ' -f1) | sort | tail -1)
  printf 'NUMBER=%04d\n' $((10#$highest + 1))
)
```

- **It prints `STOP`** — the remote or GitHub could not be reached. STOP and tell the user. Do not fall back to `ls docs/adr`: a silently reused number is exactly the failure this step exists to prevent.
- **Otherwise** `NUMBER` is the printed value: one more than the highest number on `origin/main` or in any open pull request. A gap left by a pull request that later closes unmerged is harmless; a duplicate is not.

The file is `docs/adr/<NUMBER>-<SLUG>.md`; below, `<adr-file>` stands for its filename, `<NUMBER>-<SLUG>.md`.

This narrows the race but cannot close it: a pull request opened after this step runs is not seen, and nor is an ADR in a pull request with so many changed files that `gh` truncates its file list. `scripts/check-adr-numbers.mjs` is the backstop. It runs in `scripts/verify.sh` and in CI, and fails when two files in `docs/adr` share a number. If it fails on this branch, renumber **this** ADR (it has not merged) to the next free number, never one already on `main`.

## Step 4 — Draft the ADR

Draft from [`docs/templates/adr.md`](../../../docs/templates/adr.md), with **Status** `Proposed` and **Date** `TODAY`:

- **Context** — the forces and constraints, stated as facts. Cite `REPORT` if there is one.
- **Options considered** — the realistic options with pros and cons, the chosen one marked. Take them from `REPORT` or the conversation. Delete the section if there was only one realistic option.
- **Decision** — active voice, "We will ...". Number the parts if there are several. Specific enough that a reviewer can tell whether a later change follows it.
- **Consequences** — what gets easier, what gets harder, what is now required, and the follow-up work. Include the negatives.
- **Related** — the report, workstreams, issues, superseded ADR, and architecture docs. Delete lines that do not apply.

Never invent rationale, benchmarks, or constraints that were not in the conversation or the report. Where something is missing, ask.

## Step 5 — Assess the current-state impact

Decide whether the decision changes what `docs/architecture/*.md` says is true. Read each relevant file and ask: once this decision is in effect, would any sentence here be false or incomplete?

- **Yes** — it changes a data flow, schema, module boundary, API contract, integration, runtime or deployment shape, a code pattern, or how work is tracked. Draft the architecture-doc edits now so the user reviews them with the ADR:
  - Edit the existing file for that area, or create a new `docs/architecture/<area>.md` and add a row for it to the table in `docs/architecture/README.md`.
  - Describe the resulting state, not the history, and cite the ADR the way `system-overview.md` does: `([ADR-<NUMBER>](../adr/<adr-file>))`.
  - If the decision will be implemented by later issues rather than in this PR, say so in the architecture doc, e.g. "Planned, not yet built: ... ([ADR-<NUMBER>](../adr/<adr-file>))", so the doc does not claim something exists before it does. The PR that builds it removes the "Planned" wording.
- **No** — a tooling or process decision with nothing in `docs/architecture/` describing it. Draft a specific skip reason for the commit, e.g. `[skip-adr-sync: CI caching policy, no architecture-doc impact]`. "No impact" alone is not specific enough.

## Step 6 — Review with the user

Show the user:

1. The full ADR draft.
2. The architecture-doc edits from Step 5, or the skip reason.
3. If `SUPERSEDES` is set: the status line and pointer that will be added to the old ADR (Step 8).
4. The workstream Decision log entries that will be appended (Step 9), and, if `REPORT` is still `Draft`, that it will be marked `Final`.

Ask:

> Accept this ADR, amend it, or reject it?

STOP until the user answers. Do not write the ADR file before an explicit answer.

- **Amend** — apply the changes, show the draft again, and ask again.
- **Reject** — write nothing and commit nothing. The number is not used. Tell the user and stop.
- **Accept** — only an explicit acceptance counts ("accept", "yes, accept it"). Continue.

## Step 7 — Write the ADR

Write `docs/adr/<NUMBER>-<SLUG>.md` with:

```markdown
**Status:** Accepted
**Date:** <TODAY>
```

Then apply the architecture-doc edits from Step 5, if any.

## Step 8 — Mark the superseded ADR (only with `--supersedes`)

Change **only** the old ADR's status line, and add one blockquote directly under its `**Date:**` line. Never touch its body.

Whole decision replaced:

```markdown
**Status:** Superseded by ADR-<NUMBER>
**Date:** <original date, unchanged>

> Superseded by [ADR-<NUMBER>: <title>](./<adr-file>) on <TODAY>.
```

Only part replaced (the rest still stands):

```markdown
**Status:** Accepted, partially superseded by ADR-<NUMBER>
**Date:** <original date, unchanged>

> <Section or numbered decision> superseded by [ADR-<NUMBER>: <title>](./<adr-file>) on <TODAY>. The rest of this ADR still applies.
```

Also list the old ADR under **Related** in the new ADR, and update any `docs/architecture/*.md` line that cites the old ADR for the superseded part.

## Step 9 — Link from workstreams and the report

- **Related workstreams** (from Step 2): append one line to each workstream's **Decision log**. Never edit or reorder earlier entries.

  ```markdown
  - <TODAY> — <one-line decision> ([ADR-<NUMBER>](../adr/<adr-file>))
  ```

  If the ADR resolves one of the workstream's **Open questions**, remove that question (the Decision log now holds the answer) and add a **Changelog** line.

- **`REPORT`**, if given: in `docs/reports/README.md`, add `ADR-<NUMBER>` to the report's **Follow-ups** cell. If the report is still `Draft`, set its **Status** to `Final` in the report header and in the index row: its conclusions are now acted on. Do not edit anything else in the report.

## Step 10 — Commit on a branch

Never commit on `main`. Check the current branch:

```bash
git branch --show-current
```

- **`main`, or no branch:** `git switch -c chore/adr-<NUMBER>-<SLUG>` (uncommitted changes carry over). Subject: `docs: add ADR-<NUMBER> <title>`.
- **An issue branch (`<issue-number>-<description>`):** stay on it. Subject: `docs(#<issue-number>): add ADR-<NUMBER> <title>`.
- **Any other branch:** stay on it. Subject: `docs: add ADR-<NUMBER> <title>`.

Stage only the files this skill changed:

```bash
git add docs/adr/<NUMBER>-<SLUG>.md <superseded ADR> <architecture docs> <workstream docs> <docs/reports/README.md and the report, if changed>
```

Commit. With architecture-doc edits, the subject alone is enough:

```bash
git commit -m "<subject>"
```

With no current-state impact, put the skip marker in the message body:

```bash
git commit -m "<subject>" -m "[skip-adr-sync: <specific reason>]"
```

Then confirm the sync check passes (it compares against `origin/main`, so skip this if the repository has no `origin` yet):

```bash
bash scripts/check-adr-sync.sh
```

If a hook or the check fails, fix the cause and commit again. Never use `--no-verify`. Do not push: the `push` and `pr` skills handle that.

## Step 11 — Report back

Tell the user:

- `ADR-<NUMBER>: <title>` and its path, with status `Accepted`.
- The architecture docs updated, or the `[skip-adr-sync: ...]` reason used.
- The superseded ADR, if any, and whether it was superseded in whole or in part.
- The workstreams whose Decision log was updated, and the report marked `Final`, if any.
- The branch and commit subject.
- What next: if the decision implies a body of work, the `workstream` skill (or its `--update` mode for an existing workstream); to publish, the `push` or `pr` skill.
