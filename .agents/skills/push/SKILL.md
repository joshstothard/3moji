---
name: push
description: "User-invoked only. Verify, commit, push — no PR"
disable-model-invocation: true
---

Verify, commit, and push — no PR.

1. Run `scripts/verify.sh` — if it fails, fix the issues and re-run. Do not skip.
2. Run `git status` and `git diff` to review all changes.
3. Create a commit following CONTRIBUTING.md conventions: Conventional Commits with the issue number as the scope, taken from the branch name `<issue-number>-<short-description>` (e.g. on `42-add-shell-app`, `feat(#42): add shell app route`). A `chore/` branch has no issue — use an unscoped type such as `chore: ...`.
4. Push the branch to origin with `-u` flag.

If any step fails, stop and explain. Do not force or skip gates.
