---
name: capture
description: "User-invoked only. Turn the current conversation into a tracked GitHub issue + commit"
disable-model-invocation: true
---

# Capture conversation to a GitHub issue + commit

Review the full conversation so far and do the following. Conventions (labels, issue body shape, board statuses, branch and commit format) are defined in [docs/development/github-workflow.md](../../../docs/development/github-workflow.md).

## Step 1 — Check GitHub access

No `.env` values are needed: `gh` holds the credentials, and every tracker call goes through `gh` or `scripts/gh-workflow.mjs`.

If any `gh` or `node scripts/gh-workflow.mjs` call below fails with an authentication, scope, repository, or board error, run:

```bash
node scripts/gh-workflow.mjs doctor
```

Stop and tell the user the fix it prints for each failing check (e.g. `gh auth refresh -s project`, or `node scripts/gh-workflow.mjs setup`). Do not retry until they confirm it is fixed.

## Step 2 — Determine the issue type

The type is a label:

- If the conversation is fixing broken/incorrect behaviour → `bug`
- If the conversation is adding new functionality → `enhancement`
- Otherwise → `task`

## Step 3 — Decide the starting board status

- If the conversation has **already done the work** (code or docs changed in this session, ready to commit) → **In Progress**
- If the conversation only identified or discussed work that has **not been done yet** → **Backlog**
- If it is unclear which applies, ask the user: "Has this work already been done in this session (I'll set it In Progress), or should I file it for later (Backlog)?" Wait for the answer before continuing.

## Step 4 — Create the GitHub issue

Write the body to a temp file in the issue body shape from `docs/development/github-workflow.md`, then create the issue assigned to you. Run this as a single command so the temp file variable is still set when `gh` reads it:

```bash
BODY_FILE=$(mktemp) && cat > "$BODY_FILE" <<'EOF'
## Context

<what the problem or need was, and why it matters; link any workstream, ADR, or report the conversation referenced>

## Acceptance criteria

- [ ] <observable, testable outcome>

## Notes

<what was done (if the work is already done), relevant context from the conversation, out-of-scope items, dependencies such as "Blocked by #12">
EOF
gh issue create \
  --title "<concise summary of what was discussed/fixed>" \
  --body-file "$BODY_FILE" \
  --label "<bug|enhancement|task>" \
  --assignee @me
```

For work already done in this session, tick (`- [x]`) only the acceptance criteria the conversation actually verified; leave the rest unticked.

`gh issue create` prints the new issue's URL (e.g. `https://github.com/<owner>/<repo>/issues/42`). The issue number is the last path segment — store it as `ISSUE_NUMBER` and use it for every step below.

## Step 5 — Set the board status

Use the status decided in Step 3. The helper adds the issue to the board if it is not already there, so no separate board step is needed:

```bash
node scripts/gh-workflow.mjs status <ISSUE_NUMBER> "<In Progress|Backlog>"
```

## Step 6 — Assign to an epic

Read and follow `.agents/skills/assign-epic/SKILL.md` for `#<ISSUE_NUMBER>`. It links the issue as a sub-issue of the right open `epic` issue, asks when the choice is ambiguous, and handles the no-epic case. Carry its outcome into the Step 8 report.

## Step 7 — Commit changes (if any)

Check `git status`. If there are modified/untracked files relevant to what was discussed:

1. Check the current branch with `git branch --show-current`.
   - If it is `main` (or empty/detached), **never commit there** (the pre-commit hook blocks it anyway). Create and switch to an issue branch first — uncommitted changes carry over:
     ```bash
     git switch -c <ISSUE_NUMBER>-<short-description>
     ```
     Use a 2–4 word kebab-case description derived from the issue title, e.g. `42-fix-header-contrast`.
   - If it is any other branch, stay on it. The commit message carries the new issue number even if the branch name references a different issue.
2. Stage the relevant files (by path — do not sweep in unrelated changes).
3. Commit following CONTRIBUTING.md conventions — Conventional Commits with the issue number as the scope:
   - Format: `<type>(#<ISSUE_NUMBER>): <short description>`, e.g. `fix(#42): debounce search input`
   - Types: `fix`, `feat`, `refactor`, `chore` (typically `bug` → `fix`, `enhancement` → `feat`, `task` → whichever of `refactor`/`chore` fits)

If there are no changes, skip the commit (and the branch creation) and confirm the issue was created.

## Step 8 — Report back

Tell the user:

- The issue number, title, and link (the URL printed by `gh issue create`)
- The type label and the board status it was set to
- The epic outcome from Step 6 (linked to `#<epic>`, or left unparented)
- Whether a branch was created (and its name)
- Whether a commit was made (and the commit message if so)
