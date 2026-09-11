---
name: refine
description: "User-invoked only. Pre-implementation refinement: clarifying questions, ranked approaches, posted back to the issue"
disable-model-invocation: true
---

Review a GitHub issue by number: surface clarification questions, propose implementation approaches in priority order, then post conclusions as a comment on the issue.

Refinement never changes the issue's board status or assignee. The only writes are the comment (Step 9) and, if the user approves, updated acceptance criteria in the issue body (Step 10).

**Issue input:** use the value supplied with the skill invocation.

---

## Step 0 — Normalise the issue number

Accept any of `25`, `#25`, or an issue URL such as `https://github.com/<owner>/<repo>/issues/25`:

- Strip a leading `#`.
- For a URL, take the number after `/issues/`. If the URL's `<owner>/<repo>` is not this repository (compare with `gh repo view --json nameWithOwner`), stop and tell the user.

Store the result as `ISSUE_NUMBER` and use it for all commands below.

## Step 1 — Check GitHub access

No `.env` values are needed: `gh` holds the credentials. If any `gh` or `node scripts/gh-workflow.mjs` call below fails with an authentication, scope, repository, or board error, run:

```bash
node scripts/gh-workflow.mjs doctor
```

Stop and tell the user the fix it prints for each failing check (e.g. `gh auth refresh -s project`). Do not retry until they confirm it is fixed.

## Step 2 — Fetch the issue and its comments

```bash
node scripts/gh-workflow.mjs issue <ISSUE_NUMBER>
```

Parse the JSON and extract:

- `viewer` (your GitHub login)
- `title`
- `body` (full markdown — Context / Acceptance criteria / Notes)
- `state`
- `assignees`
- `boardStatus`
- `labels` (type: `bug` / `enhancement` / `task`)
- `milestone`
- `parent` (if present — usually the epic; includes its own `parent`)
- `subIssues`
- `linkedPullRequests`
- `comments`

The helper returns the most recent 50 comments. If exactly 50 come back, read the full thread oldest-first:

```bash
gh api "repos/{owner}/{repo}/issues/<ISSUE_NUMBER>/comments" --paginate
```

For each comment, note the author login, `createdAt`, and body. Comments represent decisions and context that already exist on the issue and take precedence over any fresh analysis — read them all before proposing anything.

GitHub has no typed issue links; related issues are referenced in the body or comments (e.g. "Blocked by #12"). For each referenced issue, fetch enough to know whether it changes how this issue should be read:

```bash
gh issue view <referenced-number> --json number,title,state,labels
```

## Step 3 — Check assignee and status

If the issue is already assigned, has a `boardStatus` of In Progress, In Review, or Done, is `CLOSED`, or already has linked pull requests, ask the user to confirm they still want to refine it. Mention the GitHub user(s) it is assigned to, the current board status, and how many days it has been assigned — from the latest `assigned` event:

```bash
gh api "repos/{owner}/{repo}/issues/<ISSUE_NUMBER>/events" --paginate \
  --jq '[.[] | select(.event == "assigned")] | last | .created_at'
```

(GitHub does not expose when a board status last changed, so use the assignment date, or the issue's creation date if it was never assigned.)

## Step 4 — Fetch parent/epic and sub-issue context

If the issue has a `parent`, fetch it to understand the broader epic:

```bash
node scripts/gh-workflow.mjs issue <parent-number>
```

If the parent itself has a parent (`parent.parent`), fetch that too.

For each entry in `subIssues`, fetch the full issue:

```bash
node scripts/gh-workflow.mjs issue <sub-issue-number>
```

If the issue or its epic links a planning document — a workstream under `docs/workstreams/`, an ADR under `docs/adr/`, or a report under `docs/reports/` — read it. The workstream phase is where the issue's _why_ and its acceptance criteria usually come from.

## Step 5 — Read relevant codebase context

Based on the issue's domain (frontend, backend, infrastructure, shared), read the relevant documentation and source files to understand the current state before forming opinions:

- Always: `CONTRIBUTING.md`, `docs/development/engineering-standards.md`
- Architecture changes: `docs/architecture/context.md`, `docs/architecture/containers.md`, `docs/adr/`
- Frontend work: `docs/development/react-conventions.md`, `apps/web/`
- Backend work: `docs/development/backend-patterns.md`, `apps/api/`
- Quality/testing: `docs/development/quality-strategy.md`

## Step 6 — Analyse the issue

With all context gathered, think through:

1. **Clarity** — Are the acceptance criteria precise and testable? Are there ambiguous terms, missing edge cases, or unstated assumptions?
2. **Scope** — Is the scope appropriate? Could it be split into sub-issues? Does it implicitly require other changes not mentioned?
3. **Constraints** — What architectural, performance, security, or accessibility constraints apply? Which documented patterns are relevant?
4. **Approaches** — What are the distinct ways this could be implemented? Consider trade-offs in complexity, testability, reversibility, and alignment with existing patterns.
5. **Discussion** – Read the comments. If there are any definitive answers by human users (not actioned by an AI coding agent), those take precedence.

## Step 7 — Ask clarifications

- Ask clarifying questions to the user until you have a complete understanding of the issue. For each question, reference the specific part of the issue that is unclear. If the issue is already clear, explicitly state that no clarifications are needed.
- If there are distinct alternatives to be considered, ask the user to select one. Present up to 2 pros and cons of each alternative, and which ones you prefer and why. Highlight your preference in the name/id of each option and use 1-5 stars to rate each approach.

## Step 8 — Produce the refinement brief

Output a structured brief:

```
## Refinement: #<ISSUE_NUMBER> — <title>

### Clarifications needed
List questions where the issue is ambiguous, incomplete, or where assumptions need validating.
Be specific — reference the exact part of the description or acceptance criteria that is unclear.
If the issue is clear, say so explicitly rather than inventing questions.

### Proposed approaches

**1. <Preferred approach — recommended>**
- What: concise description of the approach
- Why preferred: alignment with existing patterns, testability, simplicity, reversibility
- Trade-offs: what you give up or accept
- Risks: what could go wrong

**2. <Alternative approach>**
- What: concise description
- Why it was considered: a legitimate reason it's viable
- Trade-offs: why it ranks lower

*(Add further alternatives only if genuinely distinct — do not pad)*

### Recommendation
One paragraph synthesising the preferred path and why, referencing the codebase context read in Step 5.

### Open questions before implementation
Numbered list of things that must be resolved before coding starts. Separate from clarifications — these are architectural or risk decisions, not ambiguities in the issue text.

### Proposed acceptance criteria
Only if refinement sharpened or added acceptance criteria: the full `- [ ]` checklist as it should read in the issue body. Omit this section otherwise.

## Clarifications resolved
- Explain that these were the clarifications that were resolved by the user when asked by the coding agent.
- For every question that was clarified, list the question and the answer that was provided by the user. This is a record of how the issue evolved from its original state to the clarified state.
- Do not summarise the questions or the answers, this is an audit trail.

```

## Step 9 — Post conclusions as an issue comment

Write the brief above to a temp file as GitHub-flavoured markdown, with a heading for each section (Clarifications, Approaches, Recommendation, Open questions, and the rest), and post it as a comment. Run it as a single command so the temp file variable is still set:

```bash
COMMENT_FILE=$(mktemp) && cat > "$COMMENT_FILE" <<'EOF'
<the refinement brief from Step 8>
EOF
gh issue comment <ISSUE_NUMBER> --body-file "$COMMENT_FILE"
```

`gh issue comment` prints the new comment's URL on success. Confirm to the user that the comment was posted (share the URL) or report the error if it failed.

Do **not** change the issue's board status, assignee, or labels — refinement is not pickup.

## Step 10 — Update acceptance criteria (only with approval)

If the brief includes **Proposed acceptance criteria**, show them to the user and ask: "Do you want me to update the issue body with these acceptance criteria?" Only on an explicit yes:

1. Fetch the current body fresh (it may have changed since Step 2):
   ```bash
   gh issue view <ISSUE_NUMBER> --json body --jq .body
   ```
2. Replace only the `## Acceptance criteria` section with the approved checklist, keeping every other section verbatim. If the body has no such section, restructure it into the Context / Acceptance criteria / Notes shape from [docs/development/github-workflow.md](../../../docs/development/github-workflow.md), keeping the existing text under Context or Notes.
3. Write the full new body to a temp file and apply it (single command):
   ```bash
   BODY_FILE=$(mktemp) && cat > "$BODY_FILE" <<'EOF'
   <the full updated issue body>
   EOF
   gh issue edit <ISSUE_NUMBER> --body-file "$BODY_FILE"
   ```

If the user declines, leave the body unchanged — the criteria are still recorded in the comment.

---

After posting, pause and ask: "Refinement posted — do you want to adjust anything before we plan the implementation?"
