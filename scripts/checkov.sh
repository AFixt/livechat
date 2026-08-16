#!/usr/bin/env bash
#
# Infrastructure-as-Code gate (Checkov). Wraps `checkov` so every accepted
# finding carries its justification in .checkov.yaml (skip-check + comment),
# exactly like scripts/semgrep.sh does for static-analysis rules and
# scripts/npm-audit.sh does for dependency advisories.
#
# What it scans: the three Dockerfiles (api/ui/widget) via Checkov's
# `dockerfile` framework. Checkov has no working docker-compose framework, so
# compose IaC misconfiguration is handled by KICS (scripts/kics.sh), not here,
# and .do/app.yaml has no Checkov parser at all. All configuration (scope +
# documented skip-checks) lives in .checkov.yaml.
#
# Checkov is a Python tool. We prefer `pipx run checkov` (isolated, no global
# install) and fall back to a `checkov` already on PATH. It is NOT an npm
# dependency — so it never touches the axe-core-banned Node tree. Most
# contributors will not have it, and the house architecture is "local gates
# first, CI as the safety net", so this script SKIPS with a clear message when
# neither is available and runs the real gate in CI, where
# .github/workflows/container-iac-scan.yml installs it.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if command -v checkov >/dev/null 2>&1; then
  RUNNER=(checkov)
elif command -v pipx >/dev/null 2>&1; then
  RUNNER=(pipx run checkov)
else
  echo "skip: checkov not installed — IaC gate not run locally." >&2
  echo "      install: pipx install checkov  (or pip install checkov)" >&2
  echo "      CI runs it via .github/workflows/container-iac-scan.yml." >&2
  exit 0
fi

echo "checkov: scanning Dockerfiles (api/ui/widget)"
# --config-file carries the frameworks, directory, and documented skip-checks.
exec "${RUNNER[@]}" --config-file .checkov.yaml "$@"
