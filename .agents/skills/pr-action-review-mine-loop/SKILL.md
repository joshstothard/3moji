---
name: pr-action-review-mine-loop
description: "User-invoked only. Action reviews on all of _your_ open PRs, looping until everything is merged or blocked"
disable-model-invocation: true
---

Review and action all open PRs raised by the current user, looping until every PR is either merged or has nothing left to action.

Usage: `pr-action-review-mine-loop` — no arguments needed.

## Step 0 — Discover open PRs

```bash
gh pr list --author "@me" --state open --json number,title,headRefName,baseRefName --limit 50
```

If there are no open PRs, tell the user "No open PRs found — nothing to do." and stop.

Print the list of PRs found so the user can see what will be processed:

```
Found N open PRs to action:
  #123 — branch-name (Title)
  ...
```

Then begin the loop. Process each PR in order from lowest number to highest.

Initialise an empty **issue queue** for this run — a list of `{ pr, issues, title }` entries for every PR that merges during the loop. Issue closing and board updates are never applied inline; they are all actioned in one batch at the end (see "End of loop").

**Issue number:** extract it from each PR's head branch, which follows `<issue-number>-<short-description>` (e.g. `42-add-shell-app` → `#42`). A `chore/` branch has no issue — use an unscoped commit type such as `chore: ...` for any commit on it.

## Loop — For each PR

Run through Steps 1–7 below for each PR in the list. After finishing all PRs, re-check for any newly opened PRs or PRs that have become actionable (reviews posted after we started) — if any exist, loop again. Stop when a full pass finds nothing new to action on any PR.

---

### Step 1 — Check out the branch

Run `git branch --show-current` to get the current branch.

- If already on the PR branch — no action needed.
- If on `main` or another branch — run `git checkout <headRefName>` automatically. No prompt needed — we already know we own all PRs in the list.

---

### Step 2 — Sync with base branch

**Do not merge the base branch into the PR branch speculatively.** Every merge-and-push recreates the full CI run (including e2e and Docker builds, ~15-20 min), and on a repo with concurrent PRs landing on `main`, re-syncing every pass turns the loop into a treadmill. Only touch git history here if GitHub itself reports a conflict. Merging is the priority — never resync with `main` just to be tidy; only do it when GitHub says you must.

1. Run `gh pr view <pr-number> --json baseRefName,mergeable,mergeStateStatus`.
2. If `mergeable` is `MERGEABLE` (no conflicts) — do nothing here. Leave the branch as pushed and continue to Step 3; eligibility and merge are decided in Step 9 against the commit already on the remote.
3. If `mergeable` is `CONFLICTING` (or `mergeStateStatus` is `DIRTY`) — only then sync locally:

   ```bash
   git fetch origin <baseRefName>
   git merge origin/<baseRefName>
   ```

   - Auto-resolve where safe (formatting, import ordering, lock-file changes).
   - For semantic conflicts, favour the PR branch's intent.
   - If a conflict cannot be safely auto-resolved, show it to the user and wait for instruction before continuing.
   - Once resolved, commit and push:
     ```bash
     git add .
     git commit -m "chore(#<issue-number>): merge <baseRefName> into <headRefName>"
     git push origin <headRefName>
     ```

4. If `mergeable` is `UNKNOWN` — GitHub hasn't computed it yet (common right after a push). Re-check once after a short pause rather than merging speculatively; treat it like `MERGEABLE` once it resolves to that state.

---

### Step 3 — Fetch all comments

- **Review comments** (line-level): `gh api repos/{owner}/{repo}/pulls/{pr}/comments --paginate`
- **Issue comments** (top-level): `gh api repos/{owner}/{repo}/issues/{pr}/comments --paginate`
- **Reviews** (resolved state): `gh api repos/{owner}/{repo}/pulls/{pr}/reviews --paginate`

The issue comments include the **AI Pre-Review** comment that `pr` posted (heading `## AI Pre-Review`) and any later `## AI Review` follow-up. Treat each finding in it as a review comment to triage:

- 🔴 **Must fix** — blocking. Resolved if marked "Fixed prior to this comment" or recorded as fixed (or rejected with a reason) in a later `## AI Review` follow-up. Otherwise it is an **unresolved blocking finding**: triage it as AUTO-FIX when the fix is clear, or NEEDS DISCUSSION when it is not.
- 🟡 **Should fix** / 🔵 **Consider** — non-blocking. Triage them like any other reviewer comment.

Also fetch unresolved review thread node IDs via GraphQL (needed for resolving later):

```bash
gh api graphql -f query='
  query {
    repository(owner: "<owner>", name: "<repo>") {
      pullRequest(number: <pr>) {
        reviewThreads(first: 50) {
          nodes { id isResolved comments(first: 1) { nodes { body } } }
        }
      }
    }
  }'
```

Skip:

- Already-resolved threads
- CI/infrastructure bots with no code suggestions (github-actions[bot], codecov, dependabot)
- Pure praise / "LGTM" with no action implied

Do NOT skip AI-reviewer comments (e.g. Copilot, CodeRabbit) or review comments you left on the PR yourself — their suggestions are substantive.

---

### Step 4 — Triage each comment

**AUTO-FIX** — act immediately:

- Clear bug, typo, or naming issue
- Style/formatting aligned with our ESLint/Prettier standards
- Missing test or obvious coverage gap
- Straightforward refactor with no architectural implication
- Security / OWASP concern with an obvious fix

**NEEDS DISCUSSION** — surface to user:

- Architectural or design decision challenge
- Significant change in approach required
- Contradicts documented standards in a non-obvious way
- Tradeoff is genuinely non-obvious
- Requires product/stakeholder input
- Vague enough to misinterpret

**INFORMATIONAL** — reply and resolve immediately (no code change):

- Questions already answered by the code or docs
- Nit / optional suggestions
- Out-of-scope observations

For informational threads: post a brief acknowledgement via `gh api`, then resolve via GraphQL. No user input needed. AI self-review findings have no thread — record their outcome in the follow-up comment described in Step 7.

---

### Step 5 — Apply AUTO-FIX changes

**Always fix on the existing PR branch — never create a new branch or a new issue for review fixes, regardless of review state.** The fix belongs to this PR and goes in this PR.

1. Make all auto-fix code changes.
2. Run `scripts/verify.sh` once after all fixes are applied.
3. If verify fails, fix the failures before continuing.
4. Commit: `fix(#<issue-number>): address PR review comments`
5. Push the branch.
6. Reply to each resolved comment (one sentence, what was done).
7. Resolve each fixed thread via GraphQL:
   ```bash
   gh api graphql -f query='
     mutation {
       resolveReviewThread(input: { threadId: "<thread_node_id>" }) {
         thread { isResolved }
       }
     }'
   ```

Only resolve threads where the fix is committed and pushed.

---

### Step 6 — Present NEEDS DISCUSSION items

For each unresolved comment that needs discussion, output:

---

**[N] @reviewer — <file>:<line> (or "general comment")**

> <exact quote>

**My assessment:** <honest view — agree, disagree, or nuanced>
**Suggested reply if we push back:** "<draft>"
**Suggested reply if we accept:** "<draft + what changes>"

---

After listing all of them: "For each item, tell me: accept / reject / skip."

---

### Step 7 — Handle user decisions

- **Accept**: make the change, reply, commit, push, resolve thread via GraphQL.
- **Reject**: post the pushback reply via `gh api`. Leave thread open.
- **Skip**: no action, thread left open.

After all decisions are actioned, run `scripts/verify.sh` once more and push.

If any AI self-review findings were actioned, post one follow-up comment with `gh pr comment <pr-number> --body-file <file>` recording each finding's outcome, so later passes (and the merge gate) can tell which blocking findings are resolved:

```
## AI Review — findings actioned

- 🔴 <file:line> — <finding> → Fixed in <short-sha>
- 🟡 <file:line> — <finding> → Rejected: <reason>
- 🔵 <file:line> — <finding> → Skipped
```

---

### Step 8 — Compute reviewer states

This computation is used by both the merge gate (Step 9) and reviewer re-requests (Step 10), so do it once.

For each reviewer, compute their **effective state**:

- Collect all their reviews, sorted oldest → newest.
- Ignore `COMMENTED` reviews entirely.
- Effective state = most recent non-`COMMENTED` review (`APPROVED`, `CHANGES_REQUESTED`, or `DISMISSED`).
- No non-`COMMENTED` reviews = has not yet reviewed.

No reviewer's approval is required (you cannot approve your own PR on GitHub), so effective states matter for two things only: a `CHANGES_REQUESTED` state blocks the merge until it is re-reviewed, and reviewers who are not `APPROVED` are the ones to re-request.

---

### Step 9 — Merge gate: merge if eligible

The solo merge rule ([ADR-0002](../../../docs/adr/0002-track-work-in-github-issues.md)) is: **AI may merge once CI is green and the AI self-review has no unresolved blocking findings.** GitHub does not allow approving your own PR, so no human approval is required. Encode that here. After all comments are actioned and the branch is pushed, evaluate eligibility:

```bash
gh pr view <pr-number> --json baseRefName,headRefName,body,closingIssuesReferences,mergeable,mergeStateStatus,reviews,statusCheckRollup

# Check state comes from the commit, not from `gh pr checks`. See the warning below.
REPO=$(gh repo view --json nameWithOwner -q .nameWithOwner)
SHA=$(gh pr view <pr-number> --json headRefOid -q .headRefOid)
gh api "repos/$REPO/commits/$SHA/check-runs" \
  --jq '{total: .total_count, incomplete: [.check_runs[] | select(.status != "completed")] | length,
         bad: [.check_runs[] | select(.conclusion != "success" and .conclusion != "skipped" and .conclusion != "neutral") | .name]}'
```

> **Never decide eligibility from `gh pr checks` alone, and never treat an empty check set as green.**
> `gh pr checks` has been observed printing "no checks reported on the branch" for a PR whose head
> commit had ten check runs in flight, and `statusCheckRollup` came back empty for the same commit.
> Both `[.[] | select(.bucket == "pending")] | length == 0` and "every check is SUCCESS" are
> **satisfied vacuously by an empty list**, so that combination reads a PR with running or failing CI
> as ready to merge. Read the commit's check runs, and require `total > 0`.
> (`scripts/auto-merge.mjs` already gets this right — its `ciProblem()` returns `ci-missing`,
> `ci-stale` or `ci-running` rather than falling through to success. This gate is the manual
> equivalent and must match it.)

A PR is **eligible to merge** when ALL of the following hold:

1. **Mergeable** — `mergeable` is `MERGEABLE` and `mergeStateStatus` is not `DIRTY`/`BLOCKED` (no conflicts, no branch-protection block).
2. **CI green, and known to be green** — the head commit reports **at least one** check run (`total > 0`), every run is `completed`, and every conclusion is `success`, `skipped` or `neutral`. Any `FAILURE`/`PENDING`/`ERROR` → not eligible yet. **An empty or missing check set is "unknown", not "green"** → not eligible; re-read the commit's check runs rather than merging. A repository that genuinely runs no CI has to opt out of this condition explicitly, because otherwise "no evidence" and "good evidence" are indistinguishable.
3. **No unresolved blocking findings** — no 🔴 AI self-review finding is still unresolved (Step 3 and the Step 7 follow-up comment).
4. **Nothing left to action** — no NEEDS-DISCUSSION items are still awaiting the user's decision, and no reviewer's effective state (Step 8) is `CHANGES_REQUESTED`.
5. **Targets `main`** — `baseRefName` is `main`. A stacked PR must not merge into its parent branch; once the parent has merged, retarget it with `gh pr edit <pr-number> --base main` and re-evaluate on the next pass.

**If eligible** — merge immediately, with no issue question and no pause. **Squash-merge by default:**

```bash
gh pr merge <pr-number> --squash --delete-branch
```

**Stacked chains keep merge commits** — squash breaks stacked PR chains, where a subsequent PR's base commit must match. If another open PR is based on this PR's branch (`gh pr list --base <headRefName> --state open`), or this PR is part of a stacked chain, merge with a merge commit instead:

```bash
gh pr merge <pr-number> --merge --delete-branch
```

Confirm it merged (`gh pr view <pr-number> --json state` → `MERGED`).

Find the issues it closes: `closingIssuesReferences` (from the `Closes #N` line in the body), falling back to the issue number from the branch name (e.g. `42-add-shell-app` → `#42`). If any are found, append `{ pr: <number>, issues: [<issue-numbers>], title: "<pr title>" }` to the **issue queue** for this run. If none can be found, note "no issue" for this PR in the final summary and do not add it to the queue. If the body deliberately references the issue without closing it (e.g. `Part of #42` or `Refs #42`), note "issue left open — partial work" and do not queue it.

Do not fetch the issue, check its assignee, or close it here — all issue bookkeeping for merged PRs happens once, in a single batch, after every PR in this run has been through the loop (see "End of loop"). Getting merges over the line takes priority over any per-PR issue bookkeeping.

Then proceed to Step 11.

**If NOT eligible**, record the reason and do not merge:

- Pending CI, with every other condition met → add the `automerge` label (`gh pr edit <pr-number> --add-label automerge`) so the auto-merge workflow merges it when CI passes ([ADR-0003](../../../docs/adr/0003-auto-merge-pull-requests-on-green-ci.md)), and note it as "set to auto-merge".
- Failing CI → leave open, note which checks are red. Do not re-request reviewers (nothing for them to do yet).
- Mergeable + CI green but a reviewer's effective state is still `CHANGES_REQUESTED` after this pass pushed fixes → go to Step 10 (re-request reviewers), leave open.
- Unresolved blocking AI self-review findings → leave open, list them, and remove the `automerge` label if present (`gh pr edit <pr-number> --remove-label automerge`).
- Stacked PR whose base is not `main` → leave open until the parent merges and it is retargeted.
- Conflicts / branch-protection block → note it, leave open. If protection is blocking because it requires an approving review, note that you cannot approve your own PR, so that rule has to be removed for the solo merge rule to work — do not try to work around it.
- Pending discussion items → leave open until the user decides.

Nothing is added to the issue queue for a PR that didn't merge.

---

### Step 10 — Re-request reviewers (only when not merged because changes were requested)

Only runs when the PR was CI-green and mergeable but a reviewer (typically a review bot such as CodeRabbit) still has `CHANGES_REQUESTED` against changes this pass addressed. Re-request review — but **only from reviewers whose effective state (Step 8) is not `APPROVED`**. Skip yourself (you cannot request your own review) and skip Copilot — re-requesting it triggers a fresh review and can keep the loop running indefinitely.

```bash
gh pr edit <pr-number> --add-reviewer <login>
```

---

### Step 11 — Issue: deferred

Issue closing and board updates are never applied per-PR in this loop. If this PR merged, its issue is already sitting in the issue queue from Step 9 — nothing more to do here. If it didn't merge, there is nothing to queue. Proceed to Step 12.

---

### Step 12 — Return to main

If this PR's branch was checked out during this iteration, read and follow `.agents/skills/wrap-up/SKILL.md` now. This switches back to main, pulls latest, and deletes the local branch — housekeeping before moving to the next PR. Do not explain what `wrap-up` does or narrate the steps; just follow it.

---

### Step 13 — PR summary

After finishing each PR, output a compact summary before moving to the next:

```
## PR #<number> — <title>

🔀 Merge: [merged ✅ / not eligible — <reason>]
✅ Auto-fixed (N): [list]
✅ Accepted (N): [list]
↩️ Pushed back (N): [list]
ℹ️ Informational (N): [list]
⏭️ Skipped (N): [list]
👤 Re-requested: [logins or "none needed"]
📋 Issue: [queued for end-of-loop batch / skipped — no issue / skipped — partial work, left open / skipped — PR still open]
```

---

## End of loop

After all PRs have been processed, run a final pass:

```bash
gh pr list --author "@me" --state open --json number,title,headRefName --limit 50
```

- Any PR that is now merged: skip.
- Any PR with new review comments since we processed it: re-process it (go back to Step 3 for that PR).
- If nothing new to action on any PR: the loop is done — move on to the issue batch below.

### Issue batch — close and mark Done every queued issue, one at a time

Once every PR is either merged or has nothing left to action, walk the issue queue built during the loop, one issue at a time, in the order PRs were merged:

For each issue in each `{ pr, issues, title }` entry:

1. **Assignee safety check.** Fetch the issue and check the assignee:

   ```bash
   node scripts/gh-workflow.mjs issue <issue-number>
   ```

   Compare `assignees` with `viewer`. If the issue is assigned, but not to you (a sign the branch name may point at the wrong issue), ask: "⚠️ #<issue-number> is assigned to [login], not you — still close it and mark it Done?" Do not continue for this issue until confirmed. An unassigned issue needs no confirmation.

2. **Confirm GitHub closed it.** `Closes #N` closes the issue when the PR merges into `main`; check `state` from the output above. If it is still `OPEN`, close it:

   ```bash
   gh issue close <issue-number> --comment "Closed by #<pr>"
   ```

3. **Set its board status to Done** before moving to the next queued issue (GitHub's built-in board automation may already have done this; setting it again is harmless):

   ```bash
   node scripts/gh-workflow.mjs status <issue-number> "Done"
   ```

   If the helper fails, note it for the final summary, suggest `node scripts/gh-workflow.mjs doctor`, and carry on with the queue.

4. **Sync its parent epic** — closes the epic and marks it Done once every sub-issue is closed, and is a no-op for an issue with no epic:

   ```bash
   node scripts/gh-workflow.mjs epic-sync <issue-number>
   ```

Work through the whole queue before printing the final summary — don't interleave issue confirmations with anything else at this point; it's the last thing this workflow does.

### Final summary

```
## Loop complete

All N PRs processed. Summary:
  #123 — merged (#41 → closed, Done)
  #124 — not eligible: CI pending / blocking finding unresolved / changes requested
  #125 — N discussion items pending user decision
```

## Notes

- Always read relevant files before making a fix — never edit from memory.
- If a fix touches multiple files, make one commit covering all of them.
- Never mark a comment as resolved unless the fix is committed and pushed.
- If the total auto-fixes across all PRs exceed 10 files, pause and summarise before proceeding.
- If `scripts/verify.sh` does not exist in the current repo, skip it and note this in the summary.
