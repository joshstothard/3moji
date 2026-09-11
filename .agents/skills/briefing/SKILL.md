---
name: briefing
description: "User-invoked only. Read-only context build: the issue, its comment trail, epic chain, and every PR raised against it"
disable-model-invocation: true
---

Build full context on a GitHub issue before follow-on work: the issue, its comments, its epic/parent chain, every PR raised against it, and the actual code those PRs shipped.

**Issue input:** use the value supplied with the skill invocation.

Usage: `briefing <issue>` — `42`, `#42`, or an issue URL.

Read-only. Does not assign, change board status, label, comment on, edit, or otherwise modify the issue or any PR — this is purely for getting the human up to speed.

---

## Step 0 — Normalise the issue number

Accept any of `25`, `#25`, or an issue URL such as `https://github.com/<owner>/<repo>/issues/25`:

- Strip a leading `#`.
- For a URL, take the number after `/issues/`. If the URL's `<owner>/<repo>` is not this repository (compare with `gh repo view --json nameWithOwner`), stop and tell the user.

Store the result as `ISSUE_NUMBER`.

## Step 1 — Check GitHub access

No `.env` values are needed: `gh` holds the credentials. Confirm `gh auth status` succeeds before any GitHub calls. If it fails, or any `gh` or `node scripts/gh-workflow.mjs` call below fails with an authentication, scope, repository, or board error, run:

```bash
node scripts/gh-workflow.mjs doctor
```

Stop and tell the user the fix it prints for each failing check (e.g. `gh auth refresh -s project`). This skill only reads, so do not run `setup` or anything else that changes GitHub state on the user's behalf.

## Step 2 — Fetch the issue and its full comment thread

```bash
node scripts/gh-workflow.mjs issue <ISSUE_NUMBER>
```

Extract `title`, `state`, `stateReason`, `author`, `createdAt`, `labels` (type: `bug` / `enhancement` / `task`), `milestone`, `assignees`, `boardStatus`, `parent` (with its own `parent`, the grandparent), `subIssues`, `linkedPullRequests`, and `body`. The body is plain GitHub markdown, normally in the Context / Acceptance criteria / Notes shape.

The helper returns only the **most recent 50** comments. A long-running issue is exactly the case where the early comments matter most, and they're the ones that cap drops — so if exactly 50 come back, fetch the whole thread (the endpoint is paginated and returns oldest-first):

```bash
gh api "repos/{owner}/{repo}/issues/<ISSUE_NUMBER>/comments" --paginate \
  --jq '.[] | {author: .user.login, created_at, body}'
```

(`gh api` fills in `{owner}` and `{repo}` from the current repository.)

Read every comment oldest-first — author login, created date, body. This is the decision trail: who asked what, who answered, what changed direction mid-issue. Distinguish an agent's own progress summary from genuine human input — the former restates what was done, the latter is a decision.

## Step 3 — Walk the epic/parent chain

The helper already gives you the parent and grandparent. Fetch each ancestor in full, starting with the parent:

```bash
node scripts/gh-workflow.mjs issue <ancestor-number>
```

Its `labels` tell you whether you've reached the epic (`epic`), and its `parent` tells you the next step up. Keep walking until you reach an issue labelled `epic` or run out of ancestors (for chains deeper than the grandparent, fetch the next ancestor with the helper the same way). Read the epic's body and comments the same way as Step 2 — the epic is where the issue's _why_ lives, not just its _what_.

If the issue or its epic links a planning document — a workstream under `docs/workstreams/`, an ADR under `docs/adr/`, or a report under `docs/reports/` — read it. A workstream's phase table and acceptance criteria are the plan the issue was cut from.

## Step 4 — Fetch sub-issues and referenced issues

For each entry in `subIssues`, fetch the full issue and its comments with `node scripts/gh-workflow.mjs issue <sub-issue-number>`.

GitHub has no typed issue links. Relationships show up as references in bodies and comments (e.g. "Blocked by #12", "Follow-up to #30") and as cross-reference events on the issue's timeline:

```bash
gh api "repos/{owner}/{repo}/issues/<ISSUE_NUMBER>/timeline" --paginate \
  --jq '.[] | {event, created_at, actor: .actor.login, source: .source.issue.number, source_is_pr: (.source.issue.pull_request != null)}'
```

The timeline also records renames, label changes, reopenings, and closures — use it for the Timeline section in Step 7. For each referenced issue, note the relationship and fetch a summary (`gh issue view <number> --json number,title,state,labels`) — enough to know if it changes how the issue should be read, not a full deep-dive unless it looks load-bearing.

## Step 5 — Find every PR raised against the issue

Search across all PR states — open, merged, and closed-without-merge all matter for context. Gather candidates from every source below:

1. **Closing references** — `linkedPullRequests` from the Step 2 JSON: PRs whose body closes this issue (`Closes #<ISSUE_NUMBER>`), including closed ones.
2. **Search** — PRs GitHub's search index associates with the number:
   ```bash
   gh pr list --state all --search "<ISSUE_NUMBER>" \
     --json number,title,state,url,body,mergedAt,author,createdAt,headRefName
   ```
   A bare number matches loosely, so keep only results that reference `#<ISSUE_NUMBER>` in the title or body, or whose head branch starts with `<ISSUE_NUMBER>-`.
3. **Full sweep** — `--search` only covers what GitHub indexes for the PR itself, so sweep the full PR list directly as a second pass, matching the title, the body, and the head branch name:
   ```bash
   gh api "repos/{owner}/{repo}/pulls?state=all" --paginate \
     --jq '.[] | select(((.title + " " + (.body // "")) | test("#<ISSUE_NUMBER>([^0-9]|$)")) or (.head.ref | test("^<ISSUE_NUMBER>-"))) | {number, title, state, head: .head.ref}'
   ```
   Pass `state` in the query string, not as `-f state=all` — `gh api` switches to POST as soon as a field is supplied, which would attempt to open a pull request instead of listing them.
4. **Timeline** — `cross-referenced` events from Step 4 where `source_is_pr` is true: PRs that mention the issue anywhere, including in a comment.

None of these passes sees inside commit messages. If you suspect a PR carries the issue only in its commits (e.g. `feat(#<ISSUE_NUMBER>): ...`) — a renamed or stacked branch is the usual cause — check the candidates explicitly:

```bash
gh pr view <number> --json commits --jq '.commits[].messageHeadline'
```

Build the full list of PR numbers touching this issue before moving on — don't process them one at a time as you find them, since a later search may surface one you'd already started summarising without it.

## Step 6 — Read each PR: description, discussion, and diff

For every PR number found:

```bash
gh pr view <number> --json title,body,state,mergedAt,headRefName,files,additions,deletions
gh pr diff <number>
gh api repos/{owner}/{repo}/pulls/<number>/comments --paginate
gh api repos/{owner}/{repo}/issues/<number>/comments --paginate
gh api repos/{owner}/{repo}/pulls/<number>/reviews --paginate
```

For each PR, note: what it actually changed (from the diff, not just the title), why (from the description), what the review (including the AI self-review) pushed back on or asked to change, and whether feedback was accepted or argued down. A PR that was closed without merging is still context — it tells you an approach was tried and abandoned, and usually why.

If a PR is large, read the diff file-by-file rather than skimming — the goal is to actually understand the shipped code, not just know that code exists.

## Step 7 — Synthesise

Produce a single narrative brief, in this order:

```
## Briefing: #<ISSUE_NUMBER> — <title>

### The ask
What the issue (and epic or workstream, if it adds meaning) actually asks for, in your own words — not a copy of the body.

### Timeline
Chronological walk through: issue created → key comments/decisions → PR(s) raised → review discussion → merge (or abandonment) → issue closed. Call out any direction changes and why they happened.

### What shipped
Per merged PR: a short summary of the actual code change (files/areas touched, the approach taken), not just "implemented the feature."

### Decisions and constraints established
Anything settled during discussion that isn't obvious from the issue text alone — naming choices, scope cuts, deliberate deferrals, "we decided not to do X because Y."

### Loose ends
Anything left open: follow-up issues mentioned, unticked acceptance criteria, open sub-issues, known limitations acknowledged in review, TODOs left in the shipped code, unresolved PR comments.
```

Keep this tight — it exists so the user can start follow-on work without re-reading everything themselves, not to reproduce everything you read.

## Step 8 — Hand back

Do not take any action on the issue or any PR. End by asking the user what they want to do with this context — the brief is preparation, not a deliverable in itself.
