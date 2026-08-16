#!/usr/bin/env bash
#
# Two-tier secret scan (trufflehog). Lives in a script rather than inline in
# package.json so the tiering and its path exclusions carry their justification
# here, exactly like scripts/semgrep.sh does for static-analysis rules.
#
# Background: before issue #82 the only secret gate was
# `trufflehog ... --results=verified --fail`, which fails ONLY on credentials
# trufflehog can confirm are live against a real service. That is a great
# blocking gate (near-zero false positives) but it is silent about the
# "suspected" tier — a detector matched, but verification could not confirm it
# (no reachable verifier, an internal-only token, a rate-limited API, or a
# genuine secret that is simply not verifiable). Those never reached anyone.
#
# Tiers:
#   verified   (default) — BLOCKING gate. `--results=verified --fail`. Exit 183
#                          on a confirmed-live secret. This is the one wired into
#                          `security` / check:all / pre-push, unchanged in
#                          behaviour from before #82.
#   suspected            — WARN only. `--results=unverified,unknown`, no --fail,
#                          so it reports detector hits that could not be verified
#                          and always exits 0. Meant for human review, not to
#                          block. Kept actionable by the path exclusions in
#                          .trufflehog-exclude.txt (test fixtures, lockfiles,
#                          i18n strings — high-noise, no live credentials) and,
#                          at line granularity, by the detect-secrets
#                          .secrets.baseline (see scripts/detect-secrets.sh).
#
# trufflehog is an external binary. The pre-commit hook and CI install it (see
# scripts/bootstrap.sh, ADR-0008); when it is absent this script SKIPS with a
# clear message and exits 0, matching the pre-commit hook's own fallback.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

TIER="${1:-verified}"

if ! command -v trufflehog >/dev/null 2>&1; then
  echo "skip: trufflehog not installed — secret scan ($TIER) not run locally." >&2
  echo "      install: run scripts/bootstrap.sh (brew, else the official installer)." >&2
  exit 0
fi

# Shared path exclusions (trufflehog-native allow-list). Only passed when the
# file exists so an accidental deletion doesn't turn the flag into an error.
# Expanded as ${EXCLUDE[@]+"${EXCLUDE[@]}"} at the call sites so an EMPTY array
# is safe under `set -u` on bash 3.2 (macOS default), where a bare
# "${EXCLUDE[@]}" would abort with "unbound variable".
EXCLUDE=()
if [ -f .trufflehog-exclude.txt ]; then
  EXCLUDE=(--exclude-paths .trufflehog-exclude.txt)
fi

case "$TIER" in
  verified)
    echo "secret-scan[verified]: blocking gate — fails on confirmed-live secrets"
    exec trufflehog git "file://$ROOT" \
      --results=verified --fail --no-update ${EXCLUDE[@]+"${EXCLUDE[@]}"}
    ;;
  suspected)
    echo "secret-scan[suspected]: warn only — unverified/unknown detector hits below (does not block)"
    # No --fail: this tier never blocks. Human-reviewed; new true positives are
    # promoted to a fix, new false positives are recorded (see the exception
    # lifecycle in docs/adr/0012-*.md).
    exec trufflehog git "file://$ROOT" \
      --results=unverified,unknown --no-update ${EXCLUDE[@]+"${EXCLUDE[@]}"}
    ;;
  *)
    echo "usage: secret-scan.sh [verified|suspected]" >&2
    exit 2
    ;;
esac
