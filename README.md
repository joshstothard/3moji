# 3moji

**Claim a handle you can say out loud.**

[3moji.me](https://3moji.me) lets you claim a short sequence of emoji as a handle and point it at a public page of links — Linktree × what3words. Your handle is `3moji.me/🧊🧊🧊`, and you can read it down the phone: _"ice cube, ice cube, ice cube."_

Emoji are on every keyboard on earth, so a handle that is three emoji long is typeable by anyone, memorable as a picture, and speakable as a phrase. At launch only three-emoji handles are claimable — one- and two-emoji handles are reserved.

> [!NOTE]
> **Status: pre-code.** The MVP is fully specified — domain model, research, and a five-phase plan — but implementation has not started. The source tree is still the scaffold this repo grew out of. See [Where the project is](#where-the-project-is) below.

## The domain

The words below are the project's vocabulary, and code is expected to use them exactly. The full glossary — with the terms each one replaces — is [CONTEXT.md](CONTEXT.md).

An **Account** (email and password) claims one **Handle**: an ordered sequence of emoji drawn from a curated **Emoji Set**. A Handle resolves to a **Profile** — display name, bio, and ordered **Links**. Each emoji has one **Spoken Name**, so a Handle can be said aloud. A **Claim** is final once the Account's email is verified; until then the Handle sits on a 24-hour **Hold**. **Reserved Handles** can never be claimed, and a **Release** gives a Handle back to the pool.

Every live Account owns exactly one Handle, so releasing a Handle and deleting an account are the same act.

## Where the project is

The decision tickets are closed. [Issue #8](https://github.com/joshstothard/3moji/issues/8) is the MVP map and the canonical record of every decision taken so far; it reached its destination on 2026-09-12. Four research reports are in [`docs/reports/`](docs/reports/README.md), and a `3moji-mvp` workstream with five phases is the next document to be written, followed by ADRs 0003 (backend shape), 0004 (Handle model), and 0005 (Emoji Set).

**Decided, not yet built.** None of the following is installed in the repo today:

| Area        | Decision                                                                                                                                                | Evidence                                               |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| Shape       | Next.js on Vercel is the whole app; route handlers and server actions are thin adapters over a framework-free `packages/core`. `apps/api` gets deleted. | [#17](https://github.com/joshstothard/3moji/issues/17) |
| Auth        | Better Auth with its Drizzle adapter; email and password only, tables in our own Postgres; `emailVerified` is the Claim gate                            | [report](docs/reports/2026-09-11-auth-library.md)      |
| Data        | Drizzle ORM on Neon Postgres via the Vercel Marketplace; migrations run in the build step                                                               | [report](docs/reports/2026-09-11-hosting-and-email.md) |
| Email       | Resend, from a `3moji.me` subdomain                                                                                                                     | [report](docs/reports/2026-09-11-hosting-and-email.md) |
| Emoji Set   | Pinned to Emoji 12.0 — 1,053 single-codepoint emoji that render on iOS 13.2+ and Android 10+, giving ~1.17 billion three-emoji Handles                  | [report](docs/reports/2026-09-11-emoji-set.md)         |
| Handle URLs | Browsers always percent-encode the path; canonicalise to a bare code-point sequence, 308 other spellings, 404 the rest                                  | [report](docs/reports/2026-09-11-emoji-urls.md)        |
| Hosting     | Vercel Hobby and free tiers — which forbids commercial use                                                                                              | [report](docs/reports/2026-09-11-hosting-and-email.md) |

The reports are dated snapshots and still carry `Status: Draft`; where a report and an ADR disagree, the ADR wins.

## What's in the repo today

A Turborepo monorepo on npm workspaces, TypeScript in strict mode throughout — adopted from the template this repo grew out of, and still carrying its demo app:

```
apps/web/        Next.js 16 (App Router) — demo OKR pages, to be replaced
apps/api/        NestJS — demo OKR module over an in-memory store; deleted in Phase 1
packages/        shared types, UI, test-utils, and the tsconfig/eslint/jest presets
docs/            reports, ADRs, architecture, workstreams, engineering standards
scripts/         verify.sh and the GitHub Issues/Project helper
```

Packages are still published under the `@template/*` scope. [`docs/architecture/system-overview.md`](docs/architecture/system-overview.md) describes this current state; it will be rewritten as the decisions above land.

## Getting started

```bash
npm install          # also installs the git hooks
npm run dev          # web on :3000, api on :3001
scripts/verify.sh    # the full CI suite, locally
```

Node 24.15+ and npm 10+ — `.nvmrc` pins the major. More in [docs/development/local-setup.md](docs/development/local-setup.md).

## How this repo is run

This is a solo project built with a coding agent, on a workflow of deterministic guardrails rather than line-by-line review: planning documents feed GitHub issues, every feature branch cites one, and layered hooks plus `scripts/verify.sh` and CI enforce quality before a human looks at anything.

- [AGENTS.md](AGENTS.md) — the agent contract: rules, workflow loop, golden rules
- [CONTRIBUTING.md](CONTRIBUTING.md) — branch, commit, PR, report, ADR, and workstream conventions
- [docs/development/github-workflow.md](docs/development/github-workflow.md) — issues, labels, epics, and the project board
- [docs/philosophy.md](docs/philosophy.md) — the engineering philosophy behind it
- [ADOPT.md](ADOPT.md) — how to import this workflow into another repo

Two escalation paths sit alongside that. The `consultant` role is a read-only second opinion on consequential design choices, reached through its adapter in `.claude/agents/`, `.codex/agents/`, or `.github/agents/`. Separately, Claude Code's built-in `advisor` tool is enabled repo-wide in `.claude/settings.json`:

```json
{
  "advisorModel": "opus"
}
```

It is experimental, Anthropic API only, and costs extra tokens on every call; opt out with `CLAUDE_CODE_DISABLE_ADVISOR_TOOL=1`. [AGENTS.md](AGENTS.md) § Consulting the `consultant` Role explains which to reach for, and why the role is deliberately not named `advisor`.

## Licence

MIT.

The workflow, agent contract, skills, and hooks come from [agentic-workflow-template](https://github.com/GavinGreenwood/agentic-workflow-template) by [Gavin Greenwood](https://github.com/GavinGreenwood), adapted here for a solo developer on GitHub Issues ([ADR-0002](docs/adr/0002-track-work-in-github-issues.md)). General improvements to the workflow itself are worth sending back upstream.
