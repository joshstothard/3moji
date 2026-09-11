# Agentic Workflow Template

A complete, battle-tested workflow for running a software project with **Claude Code, Codex, or GitHub Copilot as the development agent** — agent contract, user-invoked skills, layered guardrail hooks, Playwright MCP, and deterministic quality gates.

Everything in this repo was developed and refined on a real production client project (a Next.js + NestJS monorepo on AWS), where it ran the full delivery loop for months: tickets picked up, features built test-first, PRs raised, reviews actioned, CI fixed, dependencies maintained — with humans steering and machines enforcing quality.

> [!NOTE]
> **This copy is adapted for a solo developer using GitHub Issues — see [ADR-0002](docs/adr/0002-track-work-in-github-issues.md).** Work is tracked as GitHub issues on a GitHub Project board instead of Jira; the team-only skills (Tempo time logging, QA review, teammate PR review, multi-clone slots) are removed; and a planning layer of reports, ADRs, and workstreams feeds the board. Conventions: [docs/development/github-workflow.md](docs/development/github-workflow.md). The sections below that describe importing the upstream template still point at the original repository.

<p align="center">
  <a href="https://youtu.be/oxiBNyUlh7c" target="_blank" rel="noopener noreferrer">
    <img src="https://img.youtube.com/vi/oxiBNyUlh7c/maxresdefault.jpg" width="640" alt="Watch the walkthrough on YouTube" />
  </a>
  <br />
  <a href="https://youtu.be/oxiBNyUlh7c" target="_blank" rel="noopener noreferrer"><b>▶ Watch the walkthrough</b></a>
</p>

## Import into your repo

Open Claude Code, Codex, or GitHub Copilot in the repo you want to standardise, and paste:

```
Import the agentic workflow standards from
https://github.com/GavinGreenwood/agentic-workflow-template — read its ADOPT.md
and follow it.
```

The agent reads **[ADOPT.md](ADOPT.md)**, which is a playbook, not a copy script. It inspects your repo's actual stack (language, package manager, test runner, CI, tracker, branching model), maps every part of this template to your equivalents (dropping anything that has none), then **asks you the decisions that matter** — how strict the ticket rule is, coverage floor vs ratchet, mandatory vs recommended TDD, which quality layers and skills to bring, who owns CI — with a recommended default for each. Only after you approve the plan does it write anything. The goal is an adoption that fits _your_ repo, in _your_ language, not a TypeScript template pasted on top.

Prefer to drive it yourself? Read [ADOPT.md](ADOPT.md) directly — it doubles as a manual checklist.

## One source of truth

- `AGENTS.md` is the shared agent contract.
- `.agents/skills/` owns every workflow and reusable role.
- `scripts/hooks/` owns the shared hook behaviour.
- `.mcp.json` owns the Playwright MCP command used by Claude Code and GitHub Copilot CLI.
- `.codex/config.toml` points Codex at the same Playwright package.

Provider folders contain only the small adapters their runtimes require:

| Runtime                             | Instructions                    | Skills                                     | Roles             | Hooks                   | Playwright                                        |
| ----------------------------------- | ------------------------------- | ------------------------------------------ | ----------------- | ----------------------- | ------------------------------------------------- |
| Claude Code                         | `CLAUDE.md` imports `AGENTS.md` | `.claude/skills` symlinks `.agents/skills` | `.claude/agents/` | `.claude/settings.json` | `.mcp.json`                                       |
| Codex                               | `AGENTS.md`                     | `.agents/skills/`                          | `.codex/agents/`  | `.codex/hooks.json`     | `.codex/config.toml`                              |
| GitHub Copilot CLI and coding agent | `AGENTS.md`                     | `.agents/skills/`                          | `.github/agents/` | `.github/hooks/`        | `.mcp.json` in CLI, built in for the coding agent |

GitHub Copilot repository files belong in `.github`, not `.copilot`. GitHub.com Copilot Chat is outside this template's target, so there is no `.github/copilot-instructions.md`.

## The philosophy

This workflow is built on the engineering philosophy from two Mark Ridley articles — read these first:

1. [**Augmented Engineering for Grown-Ups**](https://www.linkedin.com/pulse/augmented-engineering-grown-ups-mark-ridley-llkve/) — the learning loop, planning in git, deterministic quality gates, Swiss cheese defence, end-to-end traceability.
2. [**Implementing Augmented Engineering**](https://mark-ridley.medium.com/implementing-augmented-engineering-d0ab1943082f) (Medium, member-only) — layered hooks (PreToolUse, PostToolUse, pre-commit, pre-push), CI pipeline structure, mutation testing, health checks.

The core idea:

> The guardrails (tests, standards, CI checks) give us confidence in the output.
> Code review is spot-checking, not line-by-line. If something slips through, we tighten the system.

The agent is fast and tireless but fallible. Instead of reviewing every line it writes, you build **layers of deterministic checks** — each imperfect, but together nearly impossible to slip through (the Swiss cheese model):

```
PreToolUse hook      blocks catastrophic commands before they run
PostToolUse hook     auto-formats + lint-fixes every file the agent touches
Stop hook            reminds the agent to sync docs before ending a turn
pre-commit hook      branch protection, lint-staged, secret detection
pre-push hook        format, lint, typecheck, tests, schema/migration parity
verify.sh            the full CI suite, runnable locally before any PR
CI pipeline          the same gates, deterministically, on every push
AI self-review       the agent reviews its own PR against 8 lenses
Human review         spot-checking — the last slice, not the only one
```

And **end-to-end traceability**: every change starts from a GitHub issue (planned from a report, ADR, or workstream when the work is non-trivial), the issue number is in the branch name and every commit, the PR says `Closes #N` with test evidence and a rollback plan, and the issue closes when the PR merges. Machine-enforced, not remembered.

## What's inside

```
ADOPT.md                  Playbook an agent follows to import this into your repo
AGENTS.md                 The agent contract — rules, workflow, golden rules
CLAUDE.md                 Claude Code import stub for AGENTS.md
CONTRIBUTING.md           Branch, commit, PR, report, and workstream conventions
.agents/
  skills/                 Skills (GitHub Issues flavour — planning, issue lifecycle, PR workflow) and reusable agent roles
.claude/
  settings.json           Claude Code hook wiring (PreToolUse / PostToolUse / Stop)
  skills                  Symlink to the canonical .agents/skills directory
  agents/                 Claude Code role adapters
.codex/
  config.toml             Codex Playwright MCP wiring
  hooks.json              Codex hook wiring
  agents/                 Codex role adapters
.mcp.json                 Shared Playwright MCP config for Claude Code and GitHub Copilot CLI
scripts/
  verify.sh               Full verification suite — same checks as CI
  gh-workflow.mjs         The one place skills talk to GitHub Issues and the Project board
  hooks/                  The shared guardrail hook scripts
.husky/                   pre-commit and pre-push quality gates
.github/
  agents/                 GitHub Copilot role adapters
  hooks/                  GitHub Copilot hook wiring
  pull_request_template.md
docs/
  philosophy.md           The engineering philosophy, expanded
  development/            Engineering standards and workflow conventions the agent codes against
  architecture/           Current-state architecture — what is true now
  adr/                    Architecture Decision Records (immutable)
  reports/                Dated research, spike, retro, and audit reports
  workstreams/            Living plans: goal, scope, phases, acceptance criteria
  templates/              Templates for reports, ADRs, and workstreams
```

### The skills

> Not sure whether to run `pr-action-review` or `pr-action-review-mine-loop`? See
> [docs/development/pr-review-workflows.md](docs/development/pr-review-workflows.md) — diagrams and a cheat sheet.

**Planning** — documents first, then issues:

| Skill        | What it does                                                                                        |
| ------------ | --------------------------------------------------------------------------------------------------- |
| `report`     | Write a dated research, spike, retro, or audit report in docs/reports                               |
| `adr`        | Draft a numbered Architecture Decision Record from the conversation, and sync the architecture docs |
| `workstream` | Scope a body of work into a workstream doc: goal, scope, phases, acceptance criteria                |
| `plan-work`  | Turn a workstream phase into an epic issue with sub-issues on the GitHub board                      |

**Delivery** — issue lifecycle, PRs, and maintenance:

| Skill                        | What it does                                                                                                                                             |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pickup <issue-number>`      | Assign the issue, read it fully, brief the work, create the branch, move it to In Progress, start PROGRESS.md                                            |
| `refine <issue-number>`      | Pre-implementation refinement: clarifying questions, ranked approaches, posted back to the issue                                                         |
| `briefing <issue-number>`    | Read-only context build: the issue, its comments, parent epic, sub-issues, board status, and every linked PR                                             |
| `capture`                    | Turn the current conversation into a tracked GitHub issue on the board + commit                                                                          |
| `pr`                         | The full ship workflow: verify → commit → push → PR from template (`Closes #N`) → AI self-review against 8 lenses → issue to In Review                   |
| `push`                       | Verify, commit, push — no PR                                                                                                                             |
| `pr-action-review <pr>`      | Fetch every review comment and the AI self-review, triage (auto-fix / discuss / informational), action them, merge when eligible, move the issue to Done |
| `pr-action-review-mine-loop` | Action reviews on all of _your_ open PRs, looping until everything is merged or blocked                                                                  |
| `pr-chore`                   | Raise a small no-issue chore PR from a worktree without touching your feature branch                                                                     |
| `wrap-up`                    | Safely return to main: checks uncommitted/unpushed work before deleting the finished branch                                                              |
| `morning`                    | Daily routine: main-branch health, CI triage (nightly workflows run on demand), Dependabot review                                                        |
| `nightly-check`              | Triage scheduled or manually-dispatched CI runs: flake vs regression vs config vs infra                                                                  |
| `fix-cicd`                   | Read the failing CI logs on this branch, diagnose flake vs real, fix or re-run                                                                           |
| `dependabot-review`          | Merge green minor/patch bumps, diagnose failing ones, escalate majors                                                                                    |
| `sync`                       | Post-pull sync: missing env vars, install, generate, build                                                                                               |
| `bump-version`               | Bump main's semver tag by one minor version and push it — a tag-only operation, no code change                                                           |

The 20 skills above are manual-only. Claude Code and GitHub Copilot CLI use the shared `disable-model-invocation: true` frontmatter. Codex uses `allow_implicit_invocation: false` in each skill's `agents/openai.yaml`. Their descriptions also say user-invoked only. `assign-epic` and `run` remain available to agents because the workflow calls them automatically.

One asymmetry to know about: `allowed-tools` in a skill's frontmatter is a **Claude Code** field. Some skills (`sync`, `wrap-up`, `bump-version`) use it so their required `Step 0 — Context (required first)` block runs start to finish without a permission prompt. Codex and Copilot CLI have no equivalent in the shared skill file — they apply their own approval model — so on those runtimes a Step 0 block may still pause for approval. The facts it gathers are identical; only the prompting differs. `verify:agents` checks that every command in a Step 0 block is allow-listed, which is Claude-specific enforcement of a provider-neutral requirement.

The two roles — `consultant` and `morlock` — are guarded the same way, one step further. Their bodies live in `.agents/skills/<role>/SKILL.md` so all three runtimes share one copy, but they are **role bodies, not skills**: they carry `disable-model-invocation: true` _and_ `user-invocable: false`, plus `allow_implicit_invocation: false` for Codex, and their descriptions begin with `Role adapter only.` so the Copilot coding agent honours the `AGENTS.md` routing rule. Nothing may select or invoke them as a skill. Each role pins a model on all three runtimes, so its model promise holds everywhere rather than falling back to whatever model the session happens to be using.

**Codex needs the role declared, not just present.** A `.codex/agents/<role>.toml` file is inert on its own — Codex only knows a role exists if `.codex/config.toml` declares it:

```toml
[agents.consultant]
config_file = "agents/consultant.toml"
```

Without that block Codex reports no spawnable roles at all, so the model and sandbox guarantees in the role description do not exist on that runtime. `verify:agents` asserts the declaration for every role.

**How hard each guarantee actually is.** A role's `model` binds on Claude Code and Copilot, and **not on Codex**. Measured on Codex 0.148.0: spawning the `consultant` role from a `gpt-5.6-luna` parent wrote `model = gpt-5.6-luna` into _both_ session rollouts — parent and child — rather than the role's pinned `gpt-5.6-sol`, with `fork_turns` omitted and again with `fork_turns: "none"` passed explicitly. Codex's own documentation for a full-history fork says it inherits the parent's model and reasoning effort and "does not accept overrides"; the measurement shows the pin not binding on either path. Copilot is the control: `--agent consultant` reports `gpt-5.6-sol` against a `claude-sonnet-4.6` default, so the pin genuinely binds there. This matters more than a documentation nit, because `verify:agents` asserts a role file _contains_ a model pin — which is not the same as the pin taking effect. On Codex the model promise in a role description is currently instruction-level only, the same status as its `sandbox_mode`. If you need the model bound there, set it on the session (`codex exec -m ...`) rather than trusting the role file. The consultant's _read-only_ property is a hard tool restriction on Claude (`tools: Read, Grep, Glob`) and Copilot (`tools: [read, search]`), and `verify:agents` asserts both lists **exactly**, not merely that they contain no write tool. Two reasons it is an allowlist. A denylist cannot see a capability it has no name for: the Copilot adapter previously granted `playwright/*`, which can click, type, and submit forms, and a check looking for `edit|execute|write` waved it through even though driving a browser is a state change whatever it is called. And the old check read the `tools` line with a same-line regex that scored a missing field, an empty field, and a YAML block list as "no write tools found" — while both runtimes read a missing field as _inherit every tool_. All three shapes passed. The parser and its regression cases in `verify-agent-workflow.mjs` exist because of that, and every shape is now asserted to fail. On Codex it is **instruction-level only, by design**: a spawned agent is deliberately not allowed to disagree with its parent about sandboxing. Codex layers role overrides first and then copies the parent turn's approval policy, cwd, and sandbox onto the child, so a role file's `sandbox_mode` parses cleanly and is then overwritten. This is not a misconfiguration to fix and not something a future key will change. Verified both directions: a `read-only` role wrote outside the repo under a permissive parent, and a `danger-full-access` role was refused under `--sandbox read-only`. If you need that boundary enforced on Codex, set the sandbox on the session (`codex --sandbox read-only`); there is no per-role mechanism. Each role is reached only through its adapter in `.claude/agents/`, `.codex/agents/`, or `.github/agents/`, which is what supplies the model, tool, and sandbox guarantees its description promises — loading the body directly would give an agent the instructions without any of them.

**Why the role is `consultant` and not `advisor`.** Claude Code ships a built-in server-side tool named `advisor` — a stronger reviewer model that receives the full conversation and is invoked by the model itself. With a role also named `advisor`, any instruction to "consult the advisor" resolves to the built-in tool on Claude Code, so the role's pinned model and read-only tool list are silently bypassed and `verify:agents` cannot see it happen. Renaming the role removes the ambiguity and lets both mechanisms run together; `AGENTS.md` § Consulting the `consultant` Role says which to reach for.

The built-in tool is enabled repo-wide in `.claude/settings.json`:

```json
{
  "advisorModel": "opus"
}
```

The [settings reference](https://code.claude.com/docs/en/settings-reference#advisormodel) permits `advisorModel` in any settings file, so committing it here makes it a repo-wide default rather than something you have to remember to run `/advisor` for in every clone. Confirmed on Claude Code 2.1.237: with no key the model reports no `advisor` tool, with the key in `.claude/settings.json` it reports one. Five things to know before adopting the template:

- It is **experimental** and **Anthropic API only** — not Bedrock, Claude Platform on AWS, Google Cloud's Agent Platform, or Microsoft Foundry. On those providers the setting is simply inert.
- It costs extra tokens, and **subagents inherit it**. The advisor re-reads the whole conversation on every call and that read is never cached, so a `consultant` delegation can itself trigger advisor calls billed against its own transcript. There is no setting that caps how often the advisor is called, and no per-role opt-out — `disallowedTools: advisor` does not suppress it.
- It is delivered by a feature flag, so anything that stops flag fetching — `DISABLE_TELEMETRY`, for one — turns it off silently.
- The advisor must be **at least as capable as the main model**. `opus` covers Haiku, Sonnet, and supported Opus mains; a Fable 5 main accepts only `fable`. An unsatisfiable pairing is rejected outright rather than downgraded, so the advisor just does not attach — no fixed value is portable across every possible main model.
- **To opt out, set `CLAUDE_CODE_DISABLE_ADVISOR_TOOL=1`.** `/advisor off` clears only your _user-level_ selection, and a committed project value outranks user settings, so it will not defeat this one.

Use the runtime's skill interface to invoke a skill:

- Claude Code: `/pickup 42`
- Codex: `$pickup 42`
- GitHub Copilot CLI: `/pickup 42`

These skills use the **GitHub CLI** (`gh`) directly — no MCP server and no `.env` credentials required. Every tracker call goes through `scripts/gh-workflow.mjs`, so the GitHub Issues and Projects plumbing lives in one place. Issue lifecycle skills keep the GitHub Project board in sync: `plan-work` and `capture` file into **Backlog**, `pickup` moves to **In Progress**, `pr` to **In Review**, and `pr-action-review` to **Done** on merge (`Closes #N` closes the issue). Set up once with `gh auth login`, `gh auth refresh -s project`, and `node scripts/gh-workflow.mjs setup` — see [docs/development/github-workflow.md](docs/development/github-workflow.md).

## Quickstart

1. **Clone and install** — `git clone <your-repo-url> && cd <repo> && npm install`. The `prepare` script installs the git hooks and repairs the `.claude/skills` link.
2. **Authenticate the GitHub CLI** — `gh auth login`, then `gh auth refresh -s project` so `gh` can manage Project boards.
3. **Create the board** — `node scripts/gh-workflow.mjs setup` creates and links a GitHub Project with the Backlog → In Progress → In Review → Done columns and the `epic`/`task`/`bug`/`enhancement` labels. Run `node scripts/gh-workflow.mjs doctor` to confirm, then open the board once and switch its layout to **Board**.
4. Confirm the `playwright` MCP server is connected in your chosen runtime.
5. **Plan the work** — invoke `report` to research a question, `adr` to record a decision, or `workstream` to scope a body of work into phases. Small, well-understood changes can skip straight to `capture`.
6. **Put it on the board** — invoke `plan-work` to turn a workstream phase into an `epic` issue with sub-issues, each with acceptance criteria the agent implements exactly.
7. **Build it** — invoke `pickup 42`: `/pickup 42` in Claude Code or GitHub Copilot CLI, or `$pickup 42` in Codex. Then `pr` to ship, and `pr-action-review` to action reviews and merge.

## Adapting it

Different tracker, CI, or stack? That's exactly what **[ADOPT.md](ADOPT.md)** handles — it maps every part of this template (the tracker calls, the `gh run` CI commands, the npm scripts and Prisma migration check) to your equivalents and drops anything with none. Point an agent at it, or work through it yourself as a checklist.

## Licence

MIT — take it, adapt it, ship with it.

Built by [Gavin Greenwood](https://github.com/GavinGreenwood). If you adapt this into your own repo and land a general improvement to the workflow itself, [PRs back to this repo](https://github.com/GavinGreenwood/agentic-workflow-template) are welcome — everyone downstream benefits.
