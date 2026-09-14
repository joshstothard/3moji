#!/usr/bin/env bash
# Validates every workflow in .github/workflows with actionlint (#266).
#
# GitHub does not reject an invalid workflow file when it is pushed. It records
# a failed run of it, with zero jobs, on every push to every branch, and the
# workflow's real triggers never fire: backup.yml's job-level `env:` read
# `runner.temp`, which GitHub does not allow there, so the nightly backup could
# never have run. actionlint reports the same class of mistake before merge.
#
# In CI (CI=true) it downloads the pinned release and refuses to run it unless
# the archive's sha256 matches the one below. Locally it uses an actionlint on
# PATH if there is one, and otherwise warns and exits 0: CI's Workflow lint job
# is the gate. See docs/development/ci-cd.md § Workflow lint.
#
# Arguments are passed to actionlint; with none it checks .github/workflows.

set -euo pipefail

ACTIONLINT_VERSION="1.7.12"
# sha256 of actionlint_1.7.12_linux_amd64.tar.gz. Checked on 2026-09-14 against
# both the release's actionlint_1.7.12_checksums.txt and GitHub's asset digest.
ACTIONLINT_LINUX_AMD64_SHA256="8aca8db96f1b94770f1b0d72b6dddcb1ebb8123cb3712530b08cc387b349a3d8"

# actionlint runs shellcheck on each `run:` script when shellcheck is installed,
# as it is on ubuntu-latest. Only warnings and errors fail the check: info and
# style findings (unquoted variables, grouped redirects) are not what makes a
# workflow invalid. .github/actionlint.yaml lists the other ignores.
export SHELLCHECK_OPTS="--severity=warning"

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root"

if [ "${CI:-}" = "true" ]; then
  if [ "$(uname -s)-$(uname -m)" != "Linux-x86_64" ]; then
    echo "actionlint is pinned for Linux x86_64 only; this runner is $(uname -s)-$(uname -m)." >&2
    exit 1
  fi
  dir="$(mktemp -d "${RUNNER_TEMP:-/tmp}/actionlint.XXXXXX")"
  archive="$dir/actionlint.tar.gz"
  curl --fail --silent --show-error --location --output "$archive" \
    "https://github.com/rhysd/actionlint/releases/download/v${ACTIONLINT_VERSION}/actionlint_${ACTIONLINT_VERSION}_linux_amd64.tar.gz"
  printf '%s  %s\n' "$ACTIONLINT_LINUX_AMD64_SHA256" "$archive" | sha256sum --check --strict -
  tar -xzf "$archive" -C "$dir" actionlint
  actionlint="$dir/actionlint"
elif command -v actionlint > /dev/null 2>&1; then
  actionlint="$(command -v actionlint)"
else
  echo "WARNING: actionlint is not installed, so the workflow files were NOT validated locally." >&2
  echo "CI's Workflow lint job validates them with actionlint ${ACTIONLINT_VERSION}." >&2
  echo "To run it here, install actionlint (for example: brew install actionlint)." >&2
  exit 0
fi

"$actionlint" -version
"$actionlint" "$@"
