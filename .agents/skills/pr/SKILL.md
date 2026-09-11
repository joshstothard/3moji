---
name: pr
description: "User-invoked only. The full ship workflow: verify → commit → push → PR from template → AI self-review against 8 lenses → issue to In Review"
disable-model-invocation: true
---

Run the full ship workflow: verify, commit, push, and open a PR.

**Issue numbers:** start from the branch name, which follows `<issue-number>-<short-description>` (e.g. `42-add-shell-app` → `#42`). Then add every issue scoped in this branch's commits — issues stacked onto the branch with `pickup --stay` commit under their own number:

```bash
git log origin/main..HEAD --format=%s | grep -oE '\(#[0-9]+\)' | tr -d '()#' | sort -un
```

The branch's issue plus that list is the set of issues this PR closes; wherever a step below says `<issue-number>`, do it for each issue in the set. A `chore/<short-description>` branch with no scoped commits has no issue — skip every issue-specific part below (the `Closes` lines, the issue status, the issue comment) and use an unscoped commit type such as `chore: ...`. See [the GitHub Issues workflow](../../../docs/development/github-workflow.md) for the conventions this skill follows.

1. Clean up ephemeral session artifacts from the repo root:
   - If `PROGRESS.md` exists, read it back to identify any docs that need updating, then delete it. Stage the deletion with `git rm PROGRESS.md` (or `git add PROGRESS.md` if already deleted). The pre-push hook blocks when `PROGRESS.md` is present, so it must be gone before step 5.
   - Delete any image files sitting untracked in the repo root (screenshots from verification sessions). Run:
     ```bash
     find . -maxdepth 1 -type f \( -name "*.png" -o -name "*.jpg" -o -name "*.jpeg" -o -name "*.gif" -o -name "*.webp" \) -delete
     ```
     These are never committed — no staging needed. If no images are present, this is a no-op.
2. Run `scripts/verify.sh` from the repo root — always `cd` to the git root first (`cd $(git rev-parse --show-toplevel)`), then run `bash scripts/verify.sh`. If it fails, fix the issues and re-run. Do not skip.
3. Run `git status` and `git diff` to review all changes.
4. Create a commit following CONTRIBUTING.md conventions: Conventional Commits with the issue number as the scope, e.g. `feat(#42): add shell app route` or `fix(#42): handle empty cart`.
5. Push the branch to origin with `-u` flag.
6. Create a PR using `gh pr create` following the PR template in `.github/pull_request_template.md`:
   - Keep the title short (under 70 characters).
   - If this branch is stacked on another branch (i.e. the PR base is not `main`), prepend the following block to the very top of the PR body — before any other content — and fill in the parent PR number, the parent's issue number, and short title:

     ```
     ⚠️ Stacked PR — depends on #<parent-pr-number> (#<parent-issue-number>: <short title of parent>). The diff shown is only this PR's changes — it can be reviewed now. **Do not merge** until #<parent-pr-number> merges first, then retarget this PR's base to `main` before merging.

     ---
     ```

   - Fill in one `Closes #<issue-number>` line per issue in the set, summary, test evidence, review checklist, and risk/rollback sections. `Closes #N` is what closes the issue on merge — GitHub only honours it when the PR merges into `main`, which is another reason a stacked PR must be retargeted before it merges.
   - Never raise stacked PRs as drafts — raise them ready for review immediately so CI and the self-review run on every PR in the chain in parallel.

7. Output the PR URL. Then:
   - Open the PR in the browser with `gh pr view <number> --web`.
8. Perform a thorough self-review of the PR diff. As the only developer you cannot approve your own PR on GitHub, so this self-review is the review gate that `pr-action-review` checks before merging:
   - Fetch the full diff: `gh pr diff`
   - Read every changed file in full before forming any opinion.
   - Review against each of these lenses — note findings under each:
     - **Correctness**: Logic errors, off-by-ones, edge cases not handled, wrong assumptions.
     - **TypeScript**: Any `any` types, missing generics, unsafe casts, type narrowing gaps.
     - **Security (OWASP)**: Injection, XSS, broken auth, exposed secrets, insecure defaults.
     - **Accessibility (WCAG AA)**: Missing ARIA, keyboard nav gaps, contrast issues, focus management.
     - **Test coverage**: Untested paths, missing edge cases, assertions that don't actually verify behaviour.
     - **Conventions**: Naming, file structure, import order, i18n keys — alignment with `docs/development/engineering-standards.md` and `CONTRIBUTING.md`.
     - **Docs sync**: Do any architecture docs, ADRs, or runbooks need updating to reflect this change?
     - **Performance**: Unnecessary re-renders, N+1 queries, unindexed lookups, large bundle additions.
   - For each finding, classify it as: 🔴 **Must fix** (bug, security, accessibility) | 🟡 **Should fix** (quality, coverage) | 🔵 **Consider** (nit, optional improvement). 🔴 findings are **blocking**: the PR must not merge while one is unresolved.
   - After reviewing, post a comment on the PR using `gh pr comment` with this structure:

     ```
     ## AI Pre-Review

     Self-review completed against correctness, TypeScript strictness, OWASP, WCAG AA, test coverage, conventions, docs sync, and performance.

     ### Findings

     <list each finding with its classification emoji, file:line reference, and a one-sentence description>

     _or_ ✅ No findings — all lenses clear.

     ### Summary

     <1–2 sentence overall assessment — is this ready to merge once CI is green, or are there blockers?>
     ```

   - If there are 🔴 Must fix findings: fix them before the comment is posted, include them in a follow-up commit, then note them as "Fixed prior to this comment" in the findings list. If a 🔴 finding cannot be fixed in this PR, list it as "Unresolved — blocks merge" so `pr-action-review` does not merge past it.
   - If there are only 🟡/🔵 findings: post the comment as-is — `pr-action-review` triages them alongside any other review comments, and you decide which to act on.
   - Once the comment is posted, opt the PR into auto-merge **only if no 🔴 finding is listed as "Unresolved — blocks merge"**. The auto-merge workflow then merges it when CI passes on an up-to-date head commit ([ADR-0003](../../../docs/adr/0003-auto-merge-pull-requests-on-green-ci.md)); it never merges into a base other than `main`, so a stacked PR waits until it is retargeted:

     ```bash
     gh pr edit <number> --add-label automerge
     ```

     If a 🔴 finding is unresolved, do not add the label: `pr-action-review` adds it once the finding is resolved. Tell the user whether the PR is set to merge itself.

9. Move each issue in the set to **In Review** on the board:

   ```bash
   node scripts/gh-workflow.mjs status <issue-number> "In Review"
   ```

   The helper adds the issue to the board if it is not already there. If it fails (for example `gh` is not authenticated or lacks the `project` scope, or no board is linked), warn the user, suggest `node scripts/gh-workflow.mjs doctor` to diagnose, and continue — do not block the rest of the workflow. Skip this step on a `chore/` branch.

10. Post an issue comment if it adds value:

    Skip this step on a `chore/` branch (there is no issue).

    Use the issue number extracted from the branch name (e.g. `42`) wherever `<issue-number>` appears below.

    Use judgment — post when a comment would genuinely help someone reading the issue later (including future you, or an agent picking up related work) understand what changed and what to verify. Skip when there's nothing meaningful to add beyond the PR title — the PR is already linked to the issue through `Closes #N`.

    **Post a comment when** the change is a bug fix, a visual/UI fix, a behaviour change, or anything where context is needed to validate it correctly. Good content to include (pick what's relevant):
    - What the problem was (the symptom)
    - Root cause, if non-obvious
    - How it was fixed
    - What to check, or what should now look/behave differently
    - The PR link

    **Skip the comment when** it's a pure refactor with no visible change, a chore (deps bump, config, docs), or the PR description already covers everything and there's nothing extra to record.

    When posting, write the body to a temp file with a single-quoted heredoc, then send it with `--body-file` (avoids shell mangling of backticks and special characters in the text). Replace `<your comment text here>` with the generated comment text:

    ```bash
    COMMENT_BODY=$(mktemp)
    cat > "$COMMENT_BODY" <<'MDEOF'
    <your comment text here>
    MDEOF

    gh issue comment <issue-number> --body-file "$COMMENT_BODY"
    rm -f "$COMMENT_BODY"
    ```

    On failure, print the `gh` error output to help diagnose it, then continue — do not block the rest of the workflow.

11. Offer to watch for CI and reviews and auto-run `pr-action-review`:

    If `--watch` was passed as an argument, skip the question below and proceed automatically as if the user said yes.

    Otherwise, ask the user:

    > "Would you like me to watch this PR and run `pr-action-review <number>` automatically once CI finishes or a review is posted? I'll check every 2 minutes — keep this terminal open."

    If the user says **yes** (or `--watch` was passed), keep this workflow active. Wait in no more than 60-second chunks for a total of 120 seconds, then check **all three** sources for activity. Prefer the current runtime's non-blocking delayed-continuation tool when it has one:

    **Source 1 — CI checks** (`gh pr checks`):

    ```bash
    gh pr checks <number> --json name,bucket \
      --jq '[.[] | select(.bucket == "pending")] | length'
    ```

    `0` means every check has finished (passed, failed, skipped, or cancelled). `gh pr checks` exits non-zero while checks are pending or failing, so read the output rather than the exit code. If `gh` reports that no checks exist for the PR, treat CI as finished.

    **Source 2 — formal reviews** (`/pulls/{pr}/reviews`), from a review bot such as Copilot or CodeRabbit, or a review you left on the PR yourself:

    ```bash
    REPO=$(gh repo view --json nameWithOwner -q .nameWithOwner)
    gh api "repos/$REPO/pulls/<number>/reviews" --paginate \
      --jq '[.[] | select(.user.login != "github-actions[bot]")] | length'
    ```

    A non-zero count means at least one review has been submitted.

    Also check for Copilot specifically:

    ```bash
    gh api "repos/$REPO/pulls/<number>/reviews" --paginate \
      --jq '[.[] | select(.user.login | ascii_downcase | contains("copilot"))] | length'
    ```

    **Source 3 — issue comments** (`/issues/{pr}/comments`):

    ```bash
    gh api "repos/$REPO/issues/<number>/comments" --paginate \
      --jq '[.[] | select(.user.login | test("github-actions|codecov|dependabot") | not) | select(.body | test("## AI (Pre-)?Review") | not)] | length'
    ```

    A non-zero count means a substantive comment has been posted (by you or a review bot) that isn't one of the agent's own AI-review comments or CI noise.

    **Decision**:
    - If **CI has finished** or **either review source** shows new activity: read and follow `.agents/skills/pr-action-review/SKILL.md` with `<number>`. **Do not schedule another wakeup** — this watcher is one-shot per PR. Running that workflow re-requests review from pending reviewers, which would trigger another Copilot review and loop indefinitely if the watcher kept running.
    - If **no source** shows activity yet: wait another 120 seconds using the same bounded method, then repeat the same checks.

If any step fails, stop and explain. Do not force or skip gates.
