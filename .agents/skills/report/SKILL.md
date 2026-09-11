---
name: report
description: "User-invoked only. Write a dated research, spike, retro, or audit report in docs/reports"
disable-model-invocation: true
---

Write a report that answers one question with cited evidence and ends with a recommendation. Reports are the first step of the planning layer described in [github-workflow.md](../../../docs/development/github-workflow.md#the-planning-layer): an ADR or workstream can then cite the report as its reason.

**Report input:** use the topic and flags supplied with the skill invocation.

Usage: `report <topic> [--type research|spike|retro|audit|incident]`

- `<topic>` — what the report is about, in the user's words.
- `--type` — defaults to `research`. Use `spike` for findings from throwaway code, `retro` for looking back at a stretch of work, `audit` for a systematic check, `incident` for something that broke.

**No PROGRESS.md needed.** A report is a document, not an implementation session.

---

## Step 1 — Parse the input

- Remove `--type <value>` from the input and store it as `TYPE` (default `research`). If the value is not one of the five types, STOP and ask which one was meant.
- The rest is the topic. Derive `SLUG`: 3-6 lowercase kebab-case words that name the question, e.g. `auth-provider-options`.
- Store today's date as `TODAY`:

```bash
date +%F
```

## Step 2 — Pin down the question

Write the question the report answers as a single sentence and show it to the user:

> **Question:** <one sentence>

If the topic has more than one reasonable reading, the scope is unclear (which part of the system, which time window for a retro, which options for research), or the constraints that decide the answer are unknown, STOP and ask. Offer your best reading as the default so the user can reply "yes". Otherwise, continue without waiting.

## Step 3 — Check for existing work

```bash
ls docs/reports docs/adr docs/workstreams
grep -ril "<key term>" docs/reports docs/adr docs/workstreams docs/architecture
```

- If a **Draft** report already answers this question, STOP and ask whether to update it instead of writing a new one.
- If a **Final** report covers it, do not edit it (Final reports are frozen). Write a new report and list the old one under **Related**.
- If an Accepted ADR has already decided the matter, say so and ask whether a report is still wanted.

## Step 4 — Gather evidence

Collect evidence before writing conclusions. Record where each fact came from as you go, so every finding can cite a source.

**Every type:**

- The repository: read the relevant code and `docs/architecture/*.md` first (the current-state layer, per `AGENTS.md` § ADR reading policy). Open an ADR only when the architecture docs cite it or are silent on the "why".
- Existing reports, ADRs, and workstreams found in Step 3.
- Git history for the areas involved:

```bash
git log --oneline --since="<window>" -- <paths>
git log -S "<symbol>" --oneline
```

**Retro and incident:** add the CI and tracker record for the window.

```bash
gh run list --limit 50
gh run view <run-id> --log-failed
gh pr list --state merged --search "merged:>=<YYYY-MM-DD>" --limit 50
gh issue list --state all --search "updated:>=<YYYY-MM-DD>" --limit 50
```

For a workstream retro, also read `docs/workstreams/<slug>.md` and each linked epic with `node scripts/gh-workflow.mjs issue <number>`.

**Spike:** build only what the question needs, outside the files you will commit (a scratch directory or a throwaway branch). Record the exact commands, the environment, and the actual output. Do not commit spike code with the report.

**Audit:** run the checks that apply (for example `bash scripts/verify.sh`, `npm audit`, or a targeted `grep` across the codebase) and record each command with its result.

**Research outside the repo:** when the runtime has a web search or fetch tool, use it. Prefer primary sources: official documentation, changelogs, release notes, standards, and the project's own issue tracker. Record each URL with the date you accessed it. When no web tool is available, say so in **Sources** and mark any claim from memory as `(unverified)`.

**Evidence rules:**

- Never invent facts, version numbers, benchmarks, prices, or quotes. If you do not know, write that you do not know.
- Every finding cites a source: `path/to/file.ts:42`, a commit SHA, a CI run URL, `#<issue>`, or a web URL.
- Mark anything you could not verify as `(unverified)`.
- A measured number states the command and environment that produced it.

## Step 5 — Write the report

Create `docs/reports/<TODAY>-<SLUG>.md` from [`docs/templates/report.md`](../../../docs/templates/report.md):

- **Type** is `TYPE` in title case. **Date** is `TODAY`. **Author** is `git config user.name`. **Status** is `Draft`.
- **Question** is the sentence from Step 2. **Summary** is 3-5 bullets a reader can act on without reading further.
- Follow the template's guidance for the type in **Findings**. Keep the **Options** table for research, spike, and audit; for a retro or incident, use it for the remedial options or delete it.
- **Next steps** names concrete candidates: decisions for the `adr` skill, bodies of work for the `workstream` skill, small fixes to file as issues with the `capture` skill.
- Delete the template's HTML comments and any placeholder you did not fill.

Add a row to the top of the index table in `docs/reports/README.md`, where `<report-file>` is the filename `<TODAY>-<SLUG>.md`:

```markdown
| <TODAY> | [<Report title>](./<report-file>) | <Type> | Draft | — |
```

## Step 6 — Review with the user

Show the user the **Question**, **Summary**, and **Recommendation**, plus any claims marked `(unverified)`. Ask:

> Commit this report as a Draft, amend it, or mark it Final?

STOP until the user answers.

- **Amend** — make the changes and ask again.
- **Mark Final** — only if the user says the conclusions are settled. Set **Status** to `Final` in the report and in its index row.
- **Commit** — continue with the status as it is.

## Step 7 — Commit on a branch

Never commit on `main`. Check the current branch:

```bash
git branch --show-current
```

- **`main`, or no branch (detached HEAD):** create a chore branch. Uncommitted changes carry over to it.

  ```bash
  git switch -c chore/report-<SLUG>
  ```

  Commit message: `docs: add <SLUG> report`.

- **An issue branch (`<issue-number>-<description>`):** stay on it. Commit message: `docs(#<issue-number>): add <SLUG> report`.
- **Any other branch:** stay on it. Commit message: `docs: add <SLUG> report`.

Stage only the report and the index, never unrelated changes in the working tree:

```bash
git add docs/reports/<TODAY>-<SLUG>.md docs/reports/README.md
git commit -m "<commit message>"
```

If a hook fails, fix the cause and commit again. Never use `--no-verify`. Do not push: the `push` and `pr` skills handle that.

## Step 8 — Report back

Tell the user:

- The report path, its type and status, and the one-line answer to the question.
- The branch and commit message.
- Any claims left `(unverified)` and how they could be checked.
- Next steps from the report, routed to the skill that handles each:
  - a decision to record → the `adr` skill, e.g. `adr "<decision title>" --from-report docs/reports/<TODAY>-<SLUG>.md`
  - a body of work to scope → the `workstream` skill
  - a small fix → the `capture` skill
- To publish: the `push` skill (push only) or the `pr` skill (push and open a PR).
