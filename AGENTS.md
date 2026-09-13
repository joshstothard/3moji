# Agent Contract

> This agent contract is informed by the engineering philosophy in [docs/philosophy.md](docs/philosophy.md) — deterministic quality gates, layered hooks, Swiss cheese defence, end-to-end traceability.
>
> The guardrails (tests, standards, CI checks) give us confidence in the output.
> Code review is spot-checking, not line-by-line. If something slips through, we tighten the system.

## Project Overview

This is a Turborepo monorepo with **Next.js** as the whole application (`apps/web`, port 3000): route handlers and server actions are thin adapters over the framework-free domain in `packages/core` ([ADR-0006](docs/adr/0006-nextjs-on-vercel-is-the-whole-application.md)). There is no separate backend process. Shared configuration is centralised in `packages/` — TypeScript compiler options, ESLint rules, Jest presets, and a stub shared library. The entire stack is TypeScript strict-mode. When adopting this template, rename the `@template` namespace to your own project scope throughout all `package.json` files. Architecture decisions live in `docs/adr/`; research reports in `docs/reports/`; workstream plans in `docs/workstreams/`. Work is tracked in GitHub Issues on a GitHub Project board — see [docs/development/github-workflow.md](docs/development/github-workflow.md).

## Repo Map

```
apps/web/              — Next.js (App Router): UI, route handlers, server actions
packages/core/         — The domain: entities, use cases, ports. Framework-free, lint-enforced
packages/shared/       — Shared types, validation schemas, utilities
packages/ui/           — Shared React component library (stub)
packages/eslint-config/ — Centralised ESLint rules (base / nextjs / nestjs)
packages/jest-config/  — Centralised Jest presets (base / nestjs / nextjs)
packages/tsconfig/     — Centralised TypeScript configs (base / nestjs / nextjs / react-library)
packages/test-utils/   — Shared test data builders and helpers (stub)
docs/                  — All documentation (reports, ADRs, workstreams, architecture, runbooks)
scripts/               — Developer and CI scripts (incl. gh-workflow.mjs, the GitHub Issues/Project helper)
```

## Workflow Loop

```
Proposal (report, ADR) -> Plan (workstream) -> Issues -> Branch -> Code -> Gates -> Deploy -> Monitor -> Trace back
```

- Work starts from GitHub issues. Every branch references an issue.
- The active coding agent can pick up issues from the backlog and execute them with the `pickup` skill for issue `42`.
- Fast feedback loops (tests, lint, typecheck) catch problems early.
- CI pipeline and repo hooks act as deterministic guardrails.
- The active coding agent should browse, test, and verify the running app as part of the build experience (e.g. via the Playwright MCP server), not just write code blindly.

The GitHub Project board mirrors this loop, and keeping it in sync is **required, not optional**. Issues move forward through four statuses — **Backlog** (`plan-work`, `capture`) → **In Progress** (`pickup`) → **In Review** (`pr`) → **Done** (on merge: the board's built-in automation, or `pr-action-review`). Set a status with `node scripts/gh-workflow.mjs status <number> "<status>"`; never hand-write the GraphQL.

## Planning Layer

Non-trivial work is planned in versioned documents before it becomes issues, so every change can cite the research and decision behind it:

```
report -> adr -> workstream -> plan-work -> pickup -> pr
```

| Document   | Lives in                            | Created by             | Mutable?                                             |
| ---------- | ----------------------------------- | ---------------------- | ---------------------------------------------------- |
| Report     | `docs/reports/YYYY-MM-DD-<slug>.md` | `report`               | Frozen once its conclusions are acted on             |
| ADR        | `docs/adr/NNNN-<slug>.md`           | `adr`                  | **Immutable** once Accepted (status line only)       |
| Workstream | `docs/workstreams/<slug>.md`        | `workstream`           | Living: status, phases, and issue links kept current |
| Issue      | GitHub                              | `plan-work`, `capture` | Closed by the PR that implements it (`Closes #N`)    |

- Take only the steps a change needs: a decision with no open question skips `report`, and a small fix goes straight from `capture` to `pickup`.
- `plan-work` turns one workstream phase into an `epic` issue with sub-issues on the board. Each issue's Context section links the workstream, ADR, or report behind it.
- `report`, `adr`, `workstream`, and `plan-work` are user-invoked only, like every other workflow skill.

Issue conventions, board statuses, templates, and the helper commands are in [docs/development/github-workflow.md](docs/development/github-workflow.md).

## Skill Invocation

`.agents/skills/` is the canonical skill source. A skill whose description starts with `User-invoked only.` may start only when the user names it, or when an already user-invoked workflow explicitly routes to its `SKILL.md`. Never select one merely because its description matches the task. `assign-epic` and `run` are automatic skills and may be selected when their descriptions match.

A skill whose description starts with `Role adapter only.` is a **role body, not a workflow**. It exists to be loaded by its role adapter in `.claude/agents/`, `.codex/agents/`, or `.github/agents/` — never as a skill in the main loop, and never on a user's behalf. The model and tool guarantees stated in a role description are supplied by the adapter, not by the `SKILL.md` (a Codex role's `sandbox_mode` is the exception — see README); loading the body on its own gives you the instructions without the guarantees and makes the description false. To consult a role, delegate to its adapter through whatever mechanism the current runtime provides. If the runtime offers none, the role is simply unavailable there — do not read the body in its place, because that is the same false-guarantee failure.

## Consulting the `consultant` Role

`consultant` is the escalation path for consequential decisions. Delegate to it — through the runtime's role adapter, never by loading the body — before committing to a non-trivial design choice, before a risky refactor, when a tradeoff is genuinely ambiguous, or when the same failure has beaten you twice. It is read-only: it returns a verdict you act on, it does not edit. Do not consult it for routine work you can handle alone.

**It is deliberately not named `advisor`.** Claude Code ships a built-in server-side tool literally named `advisor`, enabled by the `advisorModel` setting in `.claude/settings.json`. The two are different mechanisms, and on Claude Code both are live at once:

|           | Built-in `advisor` tool                                                                                            | `consultant` role                                                                                                                                                                                     |
| --------- | ------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Context   | The full conversation, every tool call and result                                                                  | On Claude Code, fresh — the role body, this contract, and the delegation prompt. **Not on Codex**: a fork inherits the parent's turns unless the delegation sets `fork_turns` to `"none"` or a number |
| Grounding | Whatever is already in the transcript                                                                              | Can read this contract, the relevant `docs/`, and the implementation — under the ADR reading policy below                                                                                             |
| Timing    | The model calls it when it wants; Claude Code prompts it to call before substantive work and before declaring done | You delegate explicitly, at a decision point you chose                                                                                                                                                |
| Guarantee | Server-side, guidance only                                                                                         | A pinned model on all three runtimes; a read-only tool list only where the adapter enforces one                                                                                                       |
| Runtimes  | Claude Code only                                                                                                   | All three                                                                                                                                                                                             |

Treat the built-in tool as the ambient second opinion — it needs no instruction from you. Delegate to `consultant` when the decision turns on **this repo's contract**: a documented standard, an ADR, an architecture doc. The built-in tool sees those only if they already happen to be in the transcript; the role goes and reads them.

**The fresh-context property is Claude Code's, not the contract's.** Codex propagates context with `fork_turns`: omitted or `"all"` means the spawned role sees the parent's whole conversation, which is the opposite of the fresh, independently-grounded read the role exists to give. A Codex delegation that wants the role's actual behaviour has to ask for it — `fork_turns: "none"`, or a small number of turns. **The role's pinned model does not bind on Codex either** — measured, not inferred: a `consultant` spawned from a `gpt-5.6-luna` parent recorded `gpt-5.6-luna` in its own session rollout, both with `fork_turns` omitted and with `fork_turns: "none"` passed explicitly. Codex documents that a full-history fork inherits the parent's model and reasoning effort and _does not accept overrides_. `verify:agents` asserts the pin is written down, which is not the same as it taking effect, so on Codex treat the model promise as instruction-level only — the same status as the role's `sandbox_mode` — and set what you need on the session instead.

**Do not read the "read-only" promise as stronger than it is.** It is a hard tool restriction only on Claude Code, and even there the declared `tools` list is not exhaustive — Claude Code injects the built-in `advisor` tool into subagents on top of it, so a `consultant` delegation can itself call the advisor and bill another uncached full-transcript read. On Codex it is instruction-level only: a role's `sandbox_mode` is overwritten by the parent's; see README. What `verify:agents` actually asserts about the roles is narrower than "read-only": that the Claude and Copilot adapters declare exactly the tool lists recorded in the verifier, so a capability cannot be added to either without an explicit edit there. (It asserts two further things unrelated to the roles, both regression guards for defects that reached `main`: that no skill's runnable code block counts pending checks through `gh pr checks` ([#71](https://github.com/joshstothard/3moji/issues/71)), and that no skill posts a body from an unnamed `--body-file <file>` placeholder ([#66](https://github.com/joshstothard/3moji/issues/66)). Anything added to that script should be listed here, or this sentence becomes wrong again.)

Never write "consult the advisor" in a prompt, skill, or commit message and expect the role. On Claude Code that phrase resolves to the built-in tool, which silently bypasses every model and tool guarantee the role description promises — the same false-guarantee failure as loading a role body directly.

## MCP Servers

`.mcp.json` configures the shared `playwright` MCP server (`@playwright/mcp`) for Claude Code and GitHub Copilot CLI. `.codex/config.toml` configures the same server for Codex. The `run` skill in `.agents/skills/run/SKILL.md` owns browser verification and uses Playwright to browse, click through, and screenshot the running app when it is available. Add further MCP servers to these shared runtime configurations as the project grows (e.g. a design-source server for Figma/Storybook, a CI-status server).

## Required Context — Read Before Every Task

Before starting any task, read the relevant context files. Do not code from memory or assumptions.

| Area                            | Files to Read                                                                                                   |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Always                          | `AGENTS.md`, `CONTRIBUTING.md`                                                                                  |
| Architecture / design decisions | `docs/architecture/`, `docs/adr/`                                                                               |
| Engineering patterns            | `docs/development/engineering-standards.md`                                                                     |
| Quality / testing               | `docs/development/quality-strategy.md`                                                                          |
| Feature work                    | The GitHub issue (`node scripts/gh-workflow.mjs issue <n>`) — it is the source of truth for acceptance criteria |
| Planned work                    | The workstream in `docs/workstreams/` that the issue or its epic links to                                       |
| Research and prior findings     | The reports in `docs/reports/` cited by the issue, workstream, or ADR                                           |

If a task spans multiple areas, read all relevant files. When in doubt, read more rather than less.

### ADR reading policy

`docs/architecture/*.md` (once populated) is the current-state layer — read it first, and treat it as the answer for "what's true now." `docs/adr/` is an immutable decision log, not required reading on its own. Only open a specific ADR by name when the architecture docs cite it (e.g. "see ADR-0021") or are silent/ambiguous on something you need the historical "why" for. Do not read the whole `docs/adr/` folder as a matter of course — as the ADR count grows, several will only _partially_ supersede earlier ones (a specific section, not the whole document), and reading the folder wholesale burns tokens walking chains that a one-line current-state fact in `docs/architecture/` would already answer.

This only works if the architecture docs stay in sync: per the Documentation Sync golden rule below, accepting an ADR that changes current-state behaviour (a data flow, a schema, a pattern) requires updating the relevant `docs/architecture/*.md` file in the _same_ PR — not just writing the ADR. An ADR with no corresponding architecture-doc update is a sync failure, not a future to-do.

CI enforces this with `scripts/check-adr-sync.sh`: a diff that touches `docs/adr/*.md` without also touching `docs/architecture/*.md` fails the build (the check no-ops until `docs/architecture/` exists). Some ADRs (tooling/process decisions) genuinely have no current-state doc to update — for those, add `[skip-adr-sync: reason]` to a commit message on the branch to skip the check. The override is reviewable in the commit history alongside the ADR itself, so keep the reason short but specific (e.g. `[skip-adr-sync: CI tooling change, no architecture-doc impact]`).

## Documentation Sync — The Golden Rule

**Documentation is the source of truth. Code follows docs, not the other way around.**

1. **Before coding**: Read the relevant docs. Your implementation must align with what's documented.
2. **If your implementation matches the docs**: Proceed. No action needed.
3. **If you need to deviate from the docs**: STOP. Do not silently diverge. Instead:
   - Flag the deviation explicitly: what the docs say vs. what you think should change and why.
   - Ask whether we should update the docs to reflect the new direction.
   - Default: update the docs first, then implement. The docs lead, code follows.
   - Also flag if the deviation might indicate we're heading in the wrong direction.
4. **After coding**: Check if any docs need updating to reflect what was built. If you added a new pattern, endpoint, data flow, ADR, or changed behaviour — update the relevant docs in the same PR.
5. **New features or significant changes**: Update architecture docs if the system shape changed. Feature context lives in the GitHub issue; the plan behind it lives in `docs/workstreams/` and `docs/reports/`.

This applies to ALL documentation: architecture, ADRs, conventions, engineering standards, quality strategy, and runbooks.

If docs are stale or contradictory, flag it. Don't guess which version is correct — ask.

## Coding Standards

When writing **any** code **always** refer to @docs/development/engineering-standards.md for best practices, patterns, and conventions.

## PROGRESS.md — Session Scratchpad

> **Primary development agent only.** PROGRESS.md is for the agent actively working a feature or fix on this branch. Secondary agents opened for quick, unrelated tasks (issue lookups, issue creation, chore commands, one-off queries) must **not** write to PROGRESS.md — they have no relevant progress to log and doing so pollutes the scratchpad and triggers the stop hook unnecessarily.

Maintain a `PROGRESS.md` file in the repo root during development sessions. This is a running log of progress, decisions, open questions, and direction changes.

### During a session

- Append progress after completing each issue or significant milestone.
- Record decisions made, problems encountered, and questions that arose.
- Note any direction changes or deviations from the plan.

### Between features / at session end

- Read back PROGRESS.md and identify which docs need updating.
- Update the relevant docs (feature docs, architecture, ADRs, etc.).
- Delete PROGRESS.md and start fresh for the next feature.

PROGRESS.md serves three purposes:

1. **Progress tracking** — proxy for progress against the plan.
2. **Knowledge capture** — temporary home for discoveries during implementation.
3. **Recovery point** — if a session is interrupted, the next session picks up where we left off.

> **Do not git-ignore `PROGRESS.md`.** It must be committable to feature branches so the recovery-point use case works across sessions. The pre-push hook and the `pr` workflow enforce that it is deleted before any PR is raised — that is sufficient. Git-ignoring it breaks cross-session continuity without adding any real protection.

### Plans

- End with a concise unresolved questions list.

## TDD Workflow (Observed Red)

Every test must be observed failing for the right reason before it counts. A test never seen red carries no evidence that it is wired to the behaviour it claims to cover — a confident assertion against a mocked collaborator goes green against an empty implementation.

Two orders satisfy this:

1. **Test first** (default): write the test, run it red, implement, run it green. Batch the suite — write the tests for the whole issue's acceptance criteria, watch them all go red, then implement. One-test-at-a-time micro-loops are human working-memory scaffolding; they cost turns here and buy the same evidence.
2. **Test after**: write the test, then break the implementation to prove the test goes red, and restore. Test-after risks deriving assertions from the code rather than the requirement — so write them from the acceptance criteria, not from the implementation.

**Exploratory-first is a path, not an exception.** When proving out an unfamiliar approach, write the production code first to validate it works, then comment it out and write the tests. The commented-out code is what produces the red run, so this satisfies the rule. Uncomment incrementally to green.

**Report the output of both runs** — the red run's assertion message and the green run's result, not a bare "tests pass". A test derived from the implementation usually fails in a boring way (wrong field, null reference) rather than the way the requirement predicts, and only the message exposes that.

**A failing test is a finding, not an obstacle.** When one blocks a change: fix the code, or say the test is wrong and why and let the human decide. Rewriting an assertion to reach green is the human's call.

This applies to unit, integration, and E2E tests.

## Working Files and Parallel Agents

**A sub-agent's scratchpad directory is keyed on the parent session, so sibling agents share it.** Two agents launched from one session get the _same_ directory, not one each. This is not hypothetical: on 2026-09-12 two agents each wrote their pre-review to `review.md`, one overwrote the other between writing and posting, and **the wrong review was posted onto a pull request** ([#66](https://github.com/joshstothard/3moji/issues/66)).

Three rules follow, and they apply to every agent that writes a file it later reads back:

1. **Never use a generic basename for a file you will read back.** Not `review.md`, `pr.md`, `body.md`, `notes.md`. Either take a unique path from `mktemp`, as most workflow skills already do, or scope the name to the work: `review-81.md`, `pr-78.md`.
2. **Verify a body before you post it.** Anything read from a file and sent to GitHub must be checked against its target first — the issue or PR number should appear in the body. A clobbered file is silent otherwise, and the failure lands in public.
3. **Never assume the scratchpad is private.** Treat it as shared with work you cannot see, because it is.

The near-miss was worse than the miss: the PR _body_ survived only because the two agents happened not to write it at the same moment.

### A shared working tree is worse than a shared scratchpad

A sub-agent launched **without worktree isolation runs in the parent's working directory**, so it shares the checkout, the index, `HEAD`, and the stash. Measured on 2026-09-12, within about twenty minutes of launching two agents that way:

- One agent switched `HEAD` to its own branch, moving the checkout for everyone in it.
- A branch belonging to the parent session was reset to `main`'s tip and **two commits were dropped from it**. They survived only as dangling objects and had to be recovered by SHA; the branch's reflog showed nothing but `branch: Created from origin/main`.
- `scripts/verify.sh` and `format:check` failed on another agent's half-finished files, twice producing a red signal that belonged to nobody's diff.
- `git push` became impossible without bypassing the pre-push hook, because the hook validates the **working tree** rather than the commit being pushed.

So, when launching parallel agents:

1. **Pass `isolation: "worktree"`.** It fixes everything in this subsection — and **nothing in the one above it.** Measured on 2026-09-12: two agents launched _with_ isolation got genuinely separate worktrees and still shared one scratchpad directory, where one overwrote the other's `prereview.md` and `pr-body.md` mid-task. Isolation separates git state, not working files. **The unique-basename rule is therefore not a fallback for forgetting isolation; it applies always.**
2. **Never `git add -A`, `git add .` or `git commit -a` in a shared tree** — stage every path explicitly, or you commit another agent's half-finished work and your own reviewer will be the one to find it.
3. **Never bare `git stash` / `git stash pop`**: the stash is shared across worktrees, so you can pop work that is not yours. Prefer a temporary commit.
4. **Treat a red `verify.sh` sceptically** before assuming it is yours; check whether the failing files are in your diff at all.
5. **To rescue a commit from a shared tree**, create a branch at its SHA (`git branch <name> <sha>`) — it touches neither `HEAD` nor the working tree — and check it out in a worktree of its own, which is also what stops another worktree force-moving it again.

## This Repository Is Public

`joshstothard/3moji` is a **public** repository. Anyone can read the code, the issues, the pull requests, and the GitHub Actions logs, without an account and without being noticed.

The rule against committing secrets was always absolute. What changes when a repository is public is the **consequence of breaking it**, and the response it demands:

- **A leaked secret is compromised the moment it is pushed**, not when someone notices. Bots scan public pushes within seconds. Assume it was read.
- **Deleting it in a later commit does not help.** Git history is permanent and public, forks keep what they cloned, and GitHub caches unreachable objects. A rewrite does not reliably erase anything.
- **The only correct response is to rotate the credential** at its source — issue a new key, revoke the old one — and only then tidy the history. Reporting "I removed it" without rotating is reporting the wrong thing as done.

Three surfaces are public that are easy to forget, because none of them is the codebase:

| Surface                      | What leaks there                                                                                                                                                                   |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Actions logs**             | Anything echoed by a command. GitHub masks values registered as repository **secrets**; it does not mask a connection string you happened to print, or a token in an error message |
| **Issues and pull requests** | Bodies, comments, and review text — including pasted logs and stack traces, which is exactly where a token tends to hide                                                           |
| **Commit metadata**          | Author name and email on every commit, permanently                                                                                                                                 |

So: never paste a raw log into an issue or PR without reading it first, never echo an environment variable in a workflow step to "check" it, and keep real values in `.env.local` (git-ignored) rather than `.env.example`, whose secret fields stay empty on purpose.

## Absolute Rules

These are non-negotiable. No exceptions, no workarounds.

1. **Every task needs a GitHub issue.** No work without an issue. **Exception:** `chore/` branches (dependency bumps, test maintenance, config housekeeping) are exempt — use a `chore/<short-description>` branch name and a `chore:` commit prefix. All feature and fix work still requires an issue.
2. **Every code change needs a feature branch** — named per CONTRIBUTING.md (`<issue-number>-<short-description>`, or `chore/<short-description>`).
3. **Merge = Close** — Every PR body carries `Closes #N`, so the issue closes when the PR merges; confirm it closed and its board status is **Done**.
4. **Never commit a schema change without a migration file** — Schema and migration travel together, always.
5. **ADRs are immutable** — Never edit the body of an accepted ADR. The only permitted change is updating its status line to `Superseded by ADR-XXXX` and adding the corresponding blockquote pointer. All decision changes require a brand new ADR. See `CONTRIBUTING.md` § Architecture Decision Records.
6. **Never push with `--no-verify`** without explicit user approval.
7. **Never ignore pre-existing errors** — Fix them, don't bypass them.
8. **Never use `any` types** — Strict TypeScript only. Use `unknown` and narrow with type guards if the type is genuinely uncertain.
9. **Always use i18n keys** (if the project is localised) — Never hardcode user-facing strings.
10. **Issue update safety check** — Before updating any issue, check its assignee. If it's assigned to someone other than the current user (an outside contributor, or a bot), STOP and ask before proceeding. On this solo repo an unassigned issue is yours to update; `pickup` assigns it to you (`gh issue edit <n> --add-assignee @me`).

## What Every Agent MUST Always Do

- **Read context first**: Read all relevant documentation files before starting any task.
- **Keep docs in sync**: Update documentation in the same PR as code changes. Never let docs drift from reality.
- **Flag deviations**: If implementation needs to differ from documented standards, flag it explicitly and discuss before proceeding.
- **Docs before code**: Create or update documentation before coding when work is non-trivial.
- **Observed red**: Every test is seen failing for the right reason before it counts (see TDD Workflow above).
- **Small changes**: Keep changes small and focused. Prefer safe refactors.
- **Tests with features**: Every feature or fix includes tests. Never reduce coverage.
- **Strict TypeScript**: No `any` types. Use strict mode, proper generics, and type guards.
- **Run verification**: Run `scripts/verify.sh` before opening a PR.
- **Follow branching rules**: Branch from `main`, name branches with the issue number (see CONTRIBUTING.md).
- **Follow commit conventions**: Include the issue number as the commit scope, e.g. `feat(#42): ...` (see CONTRIBUTING.md).
- **Close issues on merge**: Every PR body says `Closes #N`; after merge, confirm the issue closed and its board status is **Done**.
- **Respect quality gates**: Never bypass lint, typecheck, tests, or CI checks.
- **Test against standards**: Explicitly test against WCAG and OWASP compliance standards.
- **Trace everything**: Include `Closes #N`, the workstream/report/ADR link, and test evidence in PRs.
- **Fill the PR template fully**: issue, summary, test evidence, risk, rollback.

## What Every Agent MUST Never Do

- Silently deviate from documented architecture, patterns, or standards without flagging it.
- Implement code that contradicts docs without updating the docs first.
- Use `any` types in TypeScript. Ever.
- Hardcode user-facing strings instead of using i18n keys (in localised projects).
- Commit a schema change without an accompanying migration file.
- Push with `--no-verify` without explicit user approval.
- Ignore or suppress pre-existing errors, warnings, or failing tests.
- Force push to protected branches (`main`, `staging`, `production`).
- Disable or skip lint, tests, typecheck, or any CI gate.
- Commit secrets, API keys, credentials, or `.env` files.
- Hard-code credentials or sensitive values in test or application code — read them from environment variables; the only exception is a mocked secrets provider returning fixture values.
- Bypass pre-commit or pre-push hooks.
- Deploy without passing all quality gates.
- Create PRs without running `scripts/verify.sh`.
- Start work without a GitHub issue (except `chore/` branches).

## PR Review Standards

These rules apply to **all AI-assisted PR reviews** on this repo — regardless of which review command, tool, or workflow is used. This is a solo repository: the reviews a PR receives are the AI self-review raised by `pr`, review bots such as Copilot code review, and the occasional outside contributor. The standards below keep those reviews consistent and stop an agent re-litigating a finding that has already been settled.

### Always check conversation history first

Before raising any finding, fetch the full PR conversation:

```bash
gh api repos/{owner}/{repo}/pulls/{pr}/comments --paginate
gh api repos/{owner}/{repo}/issues/{pr}/comments --paginate
gh api repos/{owner}/{repo}/pulls/{pr}/reviews --paginate
```

Build a map of every finding that has been raised before. For each prior finding, determine whether it was:

- **Pushed back on** — the PR author (usually you) replied disagreeing, explained why it was intentional, or explicitly rejected the suggestion.
- **Accepted and addressed** — a fix was committed, or the thread was resolved.
- **Still open** — raised but not yet discussed.

**Never re-raise an issue that was pushed back on.** If the author has already reviewed and rejected a suggestion, raising it again is noise. If you believe the pushback was incorrect, note it once in your summary but do not re-list it as a finding.

### Verdict and approval rules

| Situation                                                    | Verdict                                                                                            |
| ------------------------------------------------------------ | -------------------------------------------------------------------------------------------------- |
| No must-fix findings detected                                | **Approve**                                                                                        |
| Must-fix findings detected, but all have been pushed back on | **Approve** — note the outstanding items in the summary for the developer, but do not block the PR |
| Must-fix findings detected and none have been discussed      | **Request changes**                                                                                |
| Must-fix findings that are new AND genuinely blockers        | **Request changes**                                                                                |

The goal is to avoid blocking PRs on findings the developer has already decided to accept. When in doubt, approve and note — do not block.

**A review from a human account counts as a human review, whatever tooling produced it.** This is an agentic workflow: reviews and approvals submitted through a coding agent or any reviewer agent are the act of the account owner, who is accountable for them. Never discount, caveat, or re-litigate an approval because its body is attributed to an AI tool, and never tell the user "no human has really reviewed this" on that basis. Only a genuine bot account (`user.type` of `Bot`, or a login containing `bot`/`copilot`) falls outside this.

### Classifying findings

- 🔴 **Must fix** — bugs, security vulnerabilities, accessibility regressions, broken contracts
- 🟡 **Should fix** — quality, coverage, convention gaps
- 🔵 **Consider** — nit, optional improvement

Only 🔴 findings block approval. 🟡 and 🔵 findings are informational — post them, but still approve.

### Review comment format

Post findings as a PR comment using `gh pr comment`:

```
## AI Review

Reviewed against correctness, TypeScript strictness, OWASP, WCAG AA, test coverage, conventions, docs sync, and performance.

**Conversation history checked** — [N previously discussed items were found; X were pushed back on and are not re-listed.]

### Findings

<list each finding with classification emoji, file:line, and one-sentence description>

_or_ ✅ No findings — all lenses clear.

### Previously discussed — not re-raised

<list any issues found in the diff that were previously raised and pushed back on, with a one-line note: "Raised previously by @reviewer — author pushed back, not re-raised.">

_or_ (omit this section if none)

### Verdict

<Approve / Request changes — and why in one sentence>
```

### After posting the review comment — submit the formal GitHub review

**This step is mandatory whenever GitHub allows it.** A `gh pr comment` does not record a verdict in GitHub's review system. Always follow it with:

```bash
gh pr review <pr-number> --approve --body '<one-line verdict summary>'
# or
gh pr review <pr-number> --request-changes --body '<one-line verdict summary>'
```

The body should be a single sentence summarising the verdict (e.g. `"No 🔴 findings — approving. One 🟡 noted in the review comment above."` or `"🔴 must-fix: <brief description> — see review comment above."`). This is what shows up in GitHub's review status and counts toward branch protection approval requirements.

**Your own PRs are the exception.** GitHub rejects an approval or change request from the PR's author, and on a solo repo the agent acts as the author. For those PRs the self-review comment raised by `pr` (`## AI Pre-Review`, plus any later `## AI Review` follow-up) is the review gate: per the solo merge rule (CONTRIBUTING.md § Pull Requests), a PR may merge when CI is green and the comment's 🔴 findings are resolved or pushed back on. Signal that with the `automerge` label, and the auto-merge workflow merges it once CI passes ([ADR-0003](docs/adr/0003-auto-merge-pull-requests-on-green-ci.md)); never add the label while a 🔴 finding is unresolved. Do not work around the restriction with a second account.

## Commands for Validation

```bash
scripts/verify.sh     # Run the full verification suite (same as CI)

npm run lint          # ESLint across all packages
npm run typecheck     # TypeScript compilation check
npm run test          # Unit tests
npm run test:e2e      # End-to-end tests
npm run build         # Production build
```

## Quality Standards

- **Unit test coverage**: Must exceed 70%.
- **WCAG**: AA compliance required. Test with axe-core or equivalent.
- **OWASP**: Top 10 vulnerabilities must be checked. Use security scanning in CI.
- **Mutation testing**: Use Stryker (or equivalent) to validate test quality — tests that kill no mutants prove nothing.
- **Design integrity**: UI work must be checked against the design source (e.g. Figma via MCP).

## Observability

- Structured JSON logging from day one.
- **No free-text error messages on personal-data paths.** A catch on a path that handles an email, a password, a session or a Profile logs through `logFailure(event, error)` in `apps/web/src/lib/log-error.ts`, never `error.message`: a message thrown by Better Auth, the `pg` driver or an email provider can quote the values involved (`Key (email)=(someone@example.com) already exists`). The line keeps its `event` and carries only allow-listed fields — the error's `name`, a SQLSTATE/Node/Better Auth `code`, an HTTP `status`, the `missing` environment variable, and the `causes` chain's names ([#134](https://github.com/joshstothard/3moji/issues/134)).
- **No third-party response text in an error an adapter constructs.** An error tracker captures `message` and the `cause` chain of a raw error, so a `logFailure` at the call site is not enough: an adapter in `packages/core` builds its errors from values that cannot carry free text — a numeric status and a code from a fixed allow-list, as properties — and never from a substring of a response body, nor attaches a third-party error as `cause`. `ResendRequestRejected` in `packages/core/src/auth/adapters/resend-email-sender.ts` is the model ([#140](https://github.com/joshstothard/3moji/issues/140)).
- **No bound query parameter in a database error that leaves an adapter.** drizzle-orm's `DrizzleQueryError` repeats the statement's parameters in its message and its own `params` property, and keeps the `pg` error — whose `detail` quotes the value — in `cause`. So no adapter in `packages/core` lets one out: the transactional stores (`runWithTransactionalAuth`, the Profile and Release stores) replace it in the catch around their transaction, and the query-only adapters run each statement through `withSafeDatabaseErrors`. What leaves is `DatabaseQueryFailed` (`packages/core/src/db/database-error.ts`): the `code` `postgresErrorCode` would have read (a SQLSTATE such as `23505`, or `ECONNREFUSED`) and the `constraint` name as allow-listed properties, a message naming only the code, and no `cause`. Errors that are not the database's — Better Auth's `APIError`, a refused connection before any statement — pass through untouched. This is fixed at the source rather than scrubbed in an error tracker's `beforeSend`, for the reason #140 fixed Resend at the source: every future consumer is safe without having to remember ([#144](https://github.com/joshstothard/3moji/issues/144)).
- **No bound query parameter in anything Better Auth throws or prints.** Sign-in, the session read, verification, password reset and sign-up issue their statements through Better Auth's Drizzle adapter, not ours. Measured against better-auth 1.7.4, a failed statement there reached three places with its parameters: the value `auth.api.*` rejects with (sign-in, verification, both reset endpoints and sign-up's opening lookup have no catch); Better Auth's logger, whose default sink is `console.error` (the session read and sign-up's insert log the raw error before throwing a clean `APIError`); and better-call's router, which `console.error`s any error that is not an `APIError` on `/api/auth/*`. So `createAuth` hands Better Auth `safeDatabaseAdapter(drizzleAdapter(…))` (`packages/core/src/auth/safe-database-adapter.ts`), which replaces a database error with `DatabaseQueryFailed` **before Better Auth sees it** — one place that covers all three surfaces and every auth instance, pooled or rebuilt against a Claim's transaction. `APIError` passes through as the same value, so `status` and `body.code` read as before ([#148](https://github.com/joshstothard/3moji/issues/148)).
- **Tracing and bound values — _proposed, awaiting the repo owner's decision_ ([#148](https://github.com/joshstothard/3moji/issues/148)).** Nothing enables tracing today, and `scripts/tracing-guard.test.mjs` fails the build if `@opentelemetry/api` becomes resolvable, a workspace declares an `@opentelemetry/*` or `@vercel/otel` package, `apps/web` gains an `instrumentation` file, or drizzle-orm's tracer starts loading the API. What would leak, measured from the installed sources: drizzle-orm 0.45.2 sets `drizzle.query.params` (`JSON.stringify(params)`) on a span for every statement, but the `import("@opentelemetry/api")` in its `tracing.ts` is commented out, so no span is ever created — an upgrade could restore it, and drizzle-orm has no option to turn parameter capture off. better-auth 1.7.4 instruments itself by default whenever `@opentelemetry/api` resolves, and its adapter factory calls `span.recordException(error)` with the _inner_ drizzle error — below the wrapper above. **Proposal:** before Phase 5 enables tracing, (1) register a span processor that, on span end and before export, deletes `drizzle.query.params` and reduces exception events and error status messages on `drizzle.*` and Better Auth `db *` spans to the SQLSTATE; (2) set Better Auth's `experimental: { instrumentation: { enabled: false } }` unless its spans are wanted, in which case (1) covers them; and (3) replace the guard with a test that exports the spans of a failed statement to an in-memory exporter and asserts no bound value appears on any of them. Until the owner decides, this is a proposal, not a rule.
- **Every request has a correlation id.** `apps/web/src/proxy.ts` sets `x-correlation-id` on the request and the response: a well-formed `x-vercel-id`, otherwise a random UUID. An incoming value is accepted only if it is ASCII letters, digits, `:`, `-` or `_`, at most 128 characters, and a client-sent `x-correlation-id` is never trusted. Route handlers and server actions read it with `readCorrelationId()` from `apps/web/src/lib/request-context.ts`, and every `logFailure` line carries it as `correlationId` (the literal `"none"` outside a request) ([#155](https://github.com/joshstothard/3moji/issues/155)). No trace_id exists yet.
- **Every API boundary writes exactly one structured JSON line per call** through `atBoundary` in `apps/web/src/lib/boundary-log.ts` — `{ event, boundary, outcome, durationMs, correlationId }`, every value a literal, a number or the allow-listed id, never free text or personal data; a new route handler or server action fails `src/lib/api-boundaries.test.ts` until it has a case there ([#156](https://github.com/joshstothard/3moji/issues/156); mapping in `docs/architecture/system-overview.md` § API boundary logging).
- Error tracking for both frontend and backend.
- Runbooks in `docs/runbooks/` for top incident types.
