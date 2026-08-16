#!/usr/bin/env bash
#
# Dockerfile lint gate (Hadolint). Lives in a script rather than inline in
# package.json so every rule exclusion carries its justification in
# .hadolint.yaml, exactly like scripts/semgrep.sh does for static-analysis
# rules and scripts/npm-audit.sh does for dependency advisories.
#
# Hadolint is an external binary. Most contributors will not have it installed,
# and the house architecture is "local gates first, CI as the safety net". So
# this script SKIPS with a clear message when the binary is absent (installable
# via `brew install hadolint` or the GitHub releases) and runs the real gate in
# CI, where .github/workflows/container-iac-scan.yml installs it. This mirrors
# how the trufflehog pre-commit hook degrades when trufflehog is missing.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# The Dockerfiles we ship. Kept explicit so a stray Dockerfile in node_modules
# or a fixture never gets linted (and so the list is auditable here).
DOCKERFILES=(
  api/Dockerfile
  ui/Dockerfile
  widget/Dockerfile
)

if ! command -v hadolint >/dev/null 2>&1; then
  echo "skip: hadolint not installed — Dockerfile lint gate not run locally." >&2
  echo "      install: brew install hadolint  (or see https://github.com/hadolint/hadolint/releases)" >&2
  echo "      CI runs it via .github/workflows/container-iac-scan.yml." >&2
  exit 0
fi

echo "hadolint: linting ${DOCKERFILES[*]}"
# --config is read implicitly from .hadolint.yaml at the repo root, but we pass
# it explicitly so the gate is not silently affected by a stray global config.
exec hadolint --config .hadolint.yaml "${DOCKERFILES[@]}" "$@"
