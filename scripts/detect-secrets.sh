#!/usr/bin/env bash
#
# Baseline drift check for the "suspected" secret tier (Yelp detect-secrets).
# Complements scripts/secret-scan.sh: trufflehog owns the two blocking/warn
# tiers by *verification*; detect-secrets owns the line-level FALSE-POSITIVE
# BASELINE (.secrets.baseline) that keeps the suspected tier actionable.
#
# What it does: re-scans the working tree with the committed .secrets.baseline
# (which carries the plugin set and the exclude-file filters), then reports any
# candidate secret that is NOT already recorded in the baseline. It WARNS and
# exits 0 — it never blocks (the blocking path is the verified trufflehog gate
# and, for staged files, the pre-commit hooks). New true positives should be
# fixed; new false positives should be recorded, see the exception lifecycle in
# docs/adr/0012-secret-scanning-tiers.md.
#
# detect-secrets is a Python tool, run via `pipx`/`pip`, never an npm dep — so
# the axe-core-banned Node tree is untouched (`npm ls axe-core` is unaffected).
# When it is unavailable this script SKIPS cleanly, like the other security
# wrappers. CI installs it (see .github/workflows and scripts/bootstrap.sh).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

BASELINE=.secrets.baseline

if command -v detect-secrets >/dev/null 2>&1; then
  DS=(detect-secrets)
elif command -v pipx >/dev/null 2>&1; then
  DS=(pipx run detect-secrets)
else
  echo "skip: detect-secrets not installed — suspected-tier baseline check not run." >&2
  echo "      install: pipx install detect-secrets  (or pip install detect-secrets)" >&2
  exit 0
fi

if [ ! -f "$BASELINE" ]; then
  echo "skip: $BASELINE missing — nothing to check against." >&2
  exit 0
fi

tmp="$(mktemp)"
trap 'rm -f "$tmp"' EXIT
cp "$BASELINE" "$tmp"

# Re-scan using the committed baseline's plugins + exclude filters. This updates
# the temp copy in place with the current findings, preserving audited labels.
"${DS[@]}" scan --baseline "$tmp" >/dev/null 2>&1 || true

# Warn (never fail) if the fresh scan surfaced any finding not already in the
# committed baseline. Compares (file, type, hashed_secret) tuples.
python3 - "$BASELINE" "$tmp" <<'PY'
import json, sys

def tuples(path):
    data = json.load(open(path))
    out = set()
    for f, items in data.get("results", {}).items():
        for it in items:
            out.add((f, it.get("type"), it.get("hashed_secret")))
    return out

committed, fresh = tuples(sys.argv[1]), tuples(sys.argv[2])
new = sorted(fresh - committed)
if not new:
    print("secret-scan[baseline]: no candidate secrets outside .secrets.baseline.")
    sys.exit(0)

print(f"secret-scan[baseline]: WARN — {len(new)} candidate secret(s) not in .secrets.baseline:")
for f, t, _ in new:
    print(f"  {f}: {t}")
print("Review each. Real secret -> remove it. False positive -> re-audit the")
print("baseline: `detect-secrets scan --baseline .secrets.baseline` then")
print("`detect-secrets audit .secrets.baseline`, and commit it with a reason.")
PY
