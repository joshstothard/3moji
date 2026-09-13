#!/usr/bin/env bash
set -euo pipefail

# verify.sh — runs the same checks as CI, locally.
# Run this before opening a PR. Adjust the script list to your project;
# --if-present lets steps no-op until the matching npm script exists.

# First, because it is the check that tells you whether the *other* local gates
# ever ran. A checkout with no installed hooks commits with no prettier and no
# secretlint, and git reports nothing (#119).
echo "=== Git Hooks Installed ==="
npm run verify:hooks

echo "=== Format ==="
npm run format:check

echo "=== Agent Workflow Parity ==="
npm run verify:agents

echo "=== Script Tests ==="
npm run test:scripts

echo "=== Codex Hook Trust ==="
npm run verify:codex-hooks

echo "=== Lint ==="
npm run lint

echo "=== i18n Key Parity ==="
npm run lint:i18n --if-present

echo "=== Typecheck ==="
npm run typecheck

echo "=== Unit Tests ==="
npm run test

echo "=== Integration Tests ==="
npm run test:integration --if-present

echo "=== Build ==="
npm run build

echo "=== ADR Sync Check ==="
bash scripts/check-adr-sync.sh origin/main

echo "=== Security Scan ==="
npm audit --audit-level=high || echo "Warning: npm audit found issues"

echo ""
echo "=== All checks passed ==="
