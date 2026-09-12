# Reports

A report answers one question and ends with a recommendation. Reports are the evidence that ADRs and workstreams cite, so a later reader (or agent) can see why a decision was made without re-running the research. See [the planning layer](../development/github-workflow.md#the-planning-layer) for how reports feed the rest of the workflow.

## What belongs here

| Type     | Use it for                                                                    |
| -------- | ----------------------------------------------------------------------------- |
| Research | Comparing options or investigating how something works before deciding        |
| Spike    | Findings from time-boxed throwaway code: what was tried and what was measured |
| Retro    | Looking back at a workstream, phase, or stretch of work                       |
| Audit    | A systematic check of the codebase or setup: security, dependencies, tests    |
| Incident | What broke, the timeline, contributing factors, and the fixes                 |

What does **not** belong here: decisions (write an ADR in [`docs/adr/`](../adr/)), plans with phases (a workstream in [`docs/workstreams/`](../workstreams/)), descriptions of the current system ([`docs/architecture/`](../architecture/)), and notes for a single issue (the issue itself, or `PROGRESS.md`).

## Naming

`YYYY-MM-DD-<slug>.md`, where the date is the day the report was written and the slug is 3-6 kebab-case words, e.g. `2026-09-11-auth-provider-options.md`. Reports sort chronologically by filename.

## How reports are created

The [`report`](../../.agents/skills/report/SKILL.md) skill writes a report from [`docs/templates/report.md`](../templates/report.md), gathers and cites the evidence, adds it to the index below, and commits it on a branch. You can also copy the template by hand.

## Lifecycle

1. **Draft**: evidence and conclusions can still change. Edit freely.
2. **Final**: the conclusions are accepted or acted on, usually because an ADR or workstream cites the report. The report is now frozen: fix plain errors (typos, broken links), but new evidence or a changed conclusion means a new report that links this one.

The index's **Follow-ups** column records the ADRs, workstreams, and issues that came from each report; the `adr` and `workstream` skills add to it.

## Index

<!-- Newest first. One row per report. Maintained by the report, adr, and workstream skills. -->

| Date | Report | Type | Status | Follow-ups |
| ---- | ------ | ---- | ------ | ---------- |
| 2026-09-11 | [Emoji Set candidate: which emoji render on both iOS and Android](2026-09-11-emoji-set.md) ([candidates JSON](2026-09-11-emoji-set.candidates.json)) | Research | Final | #9, [3moji MVP](../workstreams/3moji-mvp.md), ADR-0005 |
| 2026-09-11 | [Auth library for owned email-and-password sign-in](2026-09-11-auth-library.md) | Research | Final | #10, [3moji MVP](../workstreams/3moji-mvp.md), ADR-0003 |
| 2026-09-11 | [Free-tier Postgres and transactional email for 3moji on Vercel Hobby](2026-09-11-hosting-and-email.md) | Research | Final | #11, [3moji MVP](../workstreams/3moji-mvp.md), ADR-0003 |
| 2026-09-11 | [How emoji survive in URL paths on Vercel and Next.js](2026-09-11-emoji-urls.md) | Research | Final | #14, [3moji MVP](../workstreams/3moji-mvp.md), ADR-0004 |
