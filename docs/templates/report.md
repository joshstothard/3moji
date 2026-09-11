# <Report title>

**Type:** <Research | Spike | Retro | Audit | Incident>
**Date:** YYYY-MM-DD
**Author:** <name>
**Status:** <Draft | Final>
**Related:** <issues (#n), ADRs, workstreams, earlier reports, or "None">

<!--
Copy to docs/reports/YYYY-MM-DD-<slug>.md and add a row to the index in docs/reports/README.md.
Status: Draft while the evidence and conclusions can still change. Final once the conclusions are
accepted or acted on (an ADR or workstream cites this report). A Final report is frozen: new evidence
or a changed conclusion means a new report that links this one.
Every factual claim needs a source in "Sources". Mark anything you could not verify as "(unverified)".
Never invent numbers, versions, benchmarks, or quotes.
-->

## Question

<!-- The one question this report answers, in a single sentence. -->

<question>

## Summary

<!-- TL;DR in 3-5 bullets: the answer, the key evidence, and the recommendation. -->

- <bullet>
- <bullet>
- <bullet>

## Background

<!-- Why the question came up and what is true today. Link docs/architecture/*.md rather than restating it. -->

<background>

## Findings

<!--
What the evidence shows, each finding with its source (file:line, commit SHA, CI run URL, issue #n, or web URL).
Research: the landscape and how each candidate behaves against our constraints.
Spike: what was built, the exact commands run, and the measured results with the environment.
Retro / Incident: timeline, what went well, what did not, contributing factors (not blame).
Audit: what was checked, how, and each finding with its severity.
-->

### <Finding 1>

<finding>

## Options

<!-- Optional for retros and incidents. Effort and risk as Low / Medium / High. -->

| Option     | Pros   | Cons   | Effort  | Risk    |
| ---------- | ------ | ------ | ------- | ------- |
| <option A> | <pros> | <cons> | <L/M/H> | <L/M/H> |
| <option B> | <pros> | <cons> | <L/M/H> | <L/M/H> |

## Recommendation

<!-- What to do, and why, tied back to the findings. Say how confident you are and what would change your mind. -->

<recommendation>

## Next steps

<!-- Candidate follow-ups. Delete a line when there is nothing for it. -->

- **ADRs to write:** <decision title> (the `adr` skill)
- **Workstreams to open:** <workstream name> (the `workstream` skill)
- **Issues to file:** <issue title> (the `capture` skill)

## Sources

<!-- Numbered. Include an access date for web sources. List commands whose output you relied on. -->

1. <source>
