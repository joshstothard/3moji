---
name: assign-epic
description: Use this skill when a new GitHub issue has just been created (for example `gh issue create` just printed an issue URL). Automatically links the issue as a sub-issue of the most relevant open `epic`-labelled issue, or asks the user to choose when ambiguous. Also invoked when the user says "assign epic", "link to epic", or "which epic does this belong to". Do not use it for issues the plan-work skill creates, which it links to their epic itself.
---

# Link a GitHub issue to the right epic

Given an issue number, fetch all open epics, reason about the best match, and link the issue as a sub-issue of that epic — or ask the user to choose when it's ambiguous.

In this repository an epic is an issue labelled `epic`, and its work items are its **sub-issues** (see [docs/development/github-workflow.md](../../../docs/development/github-workflow.md)). An issue can have only one parent.

**Issue input:** use the value supplied with a direct invocation, or the issue just created (the last path segment of the URL `gh issue create` printed).

---

## Step 0 — Normalise the issue number

Accept any of `42`, `#42`, or an issue URL such as `https://github.com/<owner>/<repo>/issues/42`:

- Strip a leading `#`.
- For a URL, take the number after `/issues/`. If the URL's `<owner>/<repo>` is not this repository (compare with `gh repo view --json nameWithOwner`), stop and tell the user — the helper only works on this repository's issues.

Store the result as `ISSUE_NUMBER` and use it for all steps below.

## Step 1 — Check GitHub access

No `.env` values are needed: `gh` holds the credentials. If any `gh` or `node scripts/gh-workflow.mjs` call below fails with an authentication, scope, repository, or board error, run:

```bash
node scripts/gh-workflow.mjs doctor
```

Stop and tell the user the fix it prints for each failing check (e.g. `gh auth refresh -s project`). Do not retry silently.

## Step 2 — Fetch the target issue

```bash
node scripts/gh-workflow.mjs issue <ISSUE_NUMBER>
```

Extract from the JSON:

- `title`
- `body` (this is the primary signal for matching)
- `labels` (type: `bug` / `enhancement` / `task`)
- `state`
- `parent` (number, title, url, state — and its own `parent`, if any)

**If `labels` includes `epic`**, the issue is itself an epic. Report: "#<ISSUE_NUMBER> is an epic — epics sit at the top of the hierarchy, so there is nothing to link." Stop here.

**If `parent` is set**, check whether the parent is an epic:

```bash
gh issue view <parent-number> --json labels --jq '[.labels[].name]'
```

- **Parent is an `epic`:** report "#<ISSUE_NUMBER> is already a sub-issue of epic #<parent>: <parent title>. Do you want to move it to a different epic?" Wait for confirmation before continuing. If the user says no, stop here.
- **Parent is not an epic** (the issue is a sub-issue of an ordinary issue): report "#<ISSUE_NUMBER> is a sub-issue of #<parent>: <parent title>, which is not an epic (its epic, if any, is found further up the chain — `parent.parent` in the JSON). Linking it directly to an epic would detach it from #<parent>. Do you want to do that?" Wait for confirmation. If the user says no, stop here.

Remember the current parent as `OLD_PARENT` if the user confirms a move.

## Step 3 — Fetch all open epics

```bash
gh issue list --label epic --state open --limit 200 --json number,title,body,url
```

Build a list of candidates:

```
#<number> <title>
```

Leave out `OLD_PARENT` (if set) — the user has already said they want to move away from it, unless they pick it again explicitly.

If no open epics are found, tell the user and go to Step 4b (offer to create one or leave the issue unparented).

## Step 4 — Reason about the best match

Using the issue's title, body, and labels alongside each epic's title and body (an epic body usually links the workstream phase it came from), reason about which epic this issue most naturally belongs to.

**Confidence rules:**

- **High confidence** — one epic is a clear fit and the others are clearly not. Proceed to Step 5 without asking.
- **Ambiguous** — two or more epics are plausible, or the issue could belong to none of them. Present the shortlist and ask the user to choose (see Step 4a).
- **No match** — the issue is clearly standalone (e.g. a chore, infra task, or bug with no thematic home). Confirm with the user that leaving it unparented is intentional (see Step 4b).

**Signals that suggest no epic is needed:**

- The label is `bug` or `task` with no clear feature area.
- The title contains words like "dependency update", "upgrade", "housekeeping", "docs", "config".

### Step 4a — Ambiguous: ask the user to choose

Present a numbered list of the plausible epics:

```
I found a few possible epics for #<ISSUE_NUMBER> ("<title>"):

1. #YY — <epic title>
2. #ZZ — <epic title>
3. None of the above

Which epic should I link it to? (1/2/3 or the epic number directly)
```

Wait for the user's answer before continuing. If they choose "None of the above", go to Step 4b.

### Step 4b — No match: confirm unparented is intentional, or create an epic

```
#<ISSUE_NUMBER> ("<title>") doesn't clearly belong to any open epic.
Shall I leave it unparented, create a new epic for it, or would you like to pick one from the full list?
```

- If the user says leave it unparented, stop here and report that no change was made.
- If the user asks to see the full list, print all open epics (from Step 3) and let them pick.
- If the user wants a new epic, go to Step 4c.

### Step 4c — Create a new epic (only when the user asked for one)

Epics normally come from a workstream phase via the `plan-work` skill; an ad-hoc epic is fine for work that has no workstream yet. Propose a title and a one-paragraph context, and confirm them with the user. Then create it with the same body shape as other issues (single command, so the temp file variable is still set):

```bash
BODY_FILE=$(mktemp) && cat > "$BODY_FILE" <<'EOF'
## Context

<what this group of work is for; link the workstream, ADR, or report if one exists>

## Acceptance criteria

- [ ] <observable outcome that means the epic is done>

## Notes

<scope boundaries, anything deliberately excluded>
EOF
gh issue create --title "<epic title>" --body-file "$BODY_FILE" --label epic
```

`gh issue create` prints the epic's URL; its number is the last path segment. Put the epic on the board — "In Progress" if `#<ISSUE_NUMBER>` is already In Progress, otherwise "Backlog":

```bash
node scripts/gh-workflow.mjs status <EPIC_NUMBER> "<Backlog|In Progress>"
```

If the new epic belongs to an existing workstream under `docs/workstreams/`, tell the user so they can add it to that workstream's phase table. Continue to Step 5 with the new epic.

## Step 5 — Link the issue to the epic

**Only if moving from `OLD_PARENT`** (confirmed in Step 2): the helper refuses to link an issue that already has a parent, so remove it from the old parent first. The REST endpoint needs the issue's numeric id, not its number:

```bash
CHILD_ID=$(gh api "repos/{owner}/{repo}/issues/<ISSUE_NUMBER>" --jq .id) && \
gh api --method DELETE "repos/{owner}/{repo}/issues/<OLD_PARENT>/sub_issue" -F sub_issue_id="$CHILD_ID"
```

(`gh api` fills in `{owner}` and `{repo}` from the current repository.)

Then link it:

```bash
node scripts/gh-workflow.mjs sub-issue <EPIC_NUMBER> <ISSUE_NUMBER>
```

On success it prints `#<ISSUE_NUMBER> is now a sub-issue of #<EPIC_NUMBER> (<epic title>)` (or `... is already a sub-issue of ...`, which also counts as success).

If it fails, report the error it printed and stop. Do not retry silently. If the error is about authentication, scope, or the repository, run `doctor` as in Step 1.

## Step 6 — Report back

Tell the user:

- Issue: `#<ISSUE_NUMBER>` — `<title>` — `<issue url>`
- Epic linked: `#<EPIC_NUMBER>` — `<epic title>` — `<epic url>`
- How the match was made (high-confidence auto-match, user selection, or new epic created)
- If the issue was moved, the parent it was moved from (`#<OLD_PARENT>`)
