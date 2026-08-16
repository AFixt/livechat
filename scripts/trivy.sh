#!/usr/bin/env bash
#
# Container / filesystem / IaC-misconfiguration gate (Trivy). Wraps `trivy`
# so every accepted finding carries its justification in .trivyignore, exactly
# like scripts/semgrep.sh does for static-analysis rules and osv-scanner.toml
# does for OSV advisories.
#
# What it scans: `trivy config` walks the repo and evaluates the file types it
# recognises against its built-in misconfiguration policies — here the three
# Dockerfiles (api/ui/widget). It does NOT scan docker-compose files or
# .do/app.yaml (Trivy reports "supported files not found" for them); that gap is
# covered by KICS in scripts/kics.sh. Built-image vulnerability scanning lives in
# scripts/trivy-image.sh. Trivy reads trivy.yaml (config) and .trivyignore
# (accepted findings) from the repo root automatically; we pass --config
# explicitly so a stray global config can't change the gate.
#
# Trivy is an external binary. Most contributors will not have it installed, and
# the house architecture is "local gates first, CI as the safety net", so this
# script SKIPS with a clear message when the binary is absent (installable via
# `brew install trivy` or the release tarball) and runs the real gate in CI,
# where .github/workflows/container-iac-scan.yml installs it. This mirrors how
# the trufflehog pre-commit hook degrades when trufflehog is missing.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if ! command -v trivy >/dev/null 2>&1; then
  echo "skip: trivy not installed — Dockerfile misconfig gate not run locally." >&2
  echo "      install: brew install trivy  (or see https://github.com/aquasecurity/trivy/releases)" >&2
  echo "      CI runs it via .github/workflows/container-iac-scan.yml." >&2
  exit 0
fi

echo "trivy: scanning Dockerfiles for misconfigurations (trivy config)"
# `trivy config` evaluates the file types it recognises — here the three
# Dockerfiles. It does NOT scan docker-compose files or .do/app.yaml (Trivy
# reports "supported files not found" for those); compose IaC is KICS's job
# (scripts/kics.sh). Built-IMAGE vulnerability + secret scanning is a separate
# pass in scripts/trivy-image.sh (`trivy image`), not this config scan.
exec trivy config --config trivy.yaml "$@" .
