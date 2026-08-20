#!/usr/bin/env bash
#
# Security report-artifact generator.
#
# Runs the security-baseline scanners in REPORT mode and writes their
# machine-readable output into security-reports/ (gitignored). This is separate
# from the gating `npm run security` run: this script never fails on findings —
# it produces artifacts to archive, diff, or upload as CI job artifacts. Gating
# stays with the individual `security:*` scripts.
#
# It reuses the tools' owned configs (scripts/semgrep.sh, osv-scanner.toml,
# scripts/npm-audit.sh, the license allowlist) rather than re-declaring them, so
# there is one source of truth. Each tool is optional: if its binary is absent
# the step is skipped with a note (same graceful-degradation contract as
# scripts/semgrep.sh) so the generator runs anywhere.
#
set -euo pipefail

OUT="${SECURITY_REPORTS_DIR:-security-reports}"
mkdir -p "$OUT"

echo "security-report: writing artifacts to $OUT/"
have() { command -v "$1" >/dev/null 2>&1; }

# --- npm audit (npm is always present) -----------------------------------
echo "[npm-audit]  -> $OUT/npm-audit.json"
npm audit --workspaces --include-workspace-root --json >"$OUT/npm-audit.json" 2>/dev/null || true

# --- osv-scanner ----------------------------------------------------------
if have osv-scanner; then
  echo "[osv]        -> $OUT/osv.json"
  osv-scanner --format json --lockfile=package-lock.json >"$OUT/osv.json" 2>/dev/null || true
else
  echo "[osv]        skip: osv-scanner not installed"
fi

# --- semgrep (reuses scripts/semgrep.sh config; --error is a no-op here) --
if have semgrep; then
  echo "[semgrep]    -> $OUT/semgrep.json"
  bash scripts/semgrep.sh --json --output="$OUT/semgrep.json" >/dev/null 2>&1 || true
else
  echo "[semgrep]    skip: semgrep not installed"
fi

# --- license inventory ----------------------------------------------------
if have license-checker-rseidelsohn || [[ -x node_modules/.bin/license-checker-rseidelsohn ]]; then
  echo "[licenses]   -> $OUT/licenses.json"
  npx --no-install license-checker-rseidelsohn --production --json >"$OUT/licenses.json" 2>/dev/null || true
else
  echo "[licenses]   skip: license-checker-rseidelsohn not available"
fi

# --- exception registry status -------------------------------------------
echo "[exceptions] -> $OUT/exceptions-status.txt"
bash scripts/check-exceptions.sh >"$OUT/exceptions-status.txt" 2>&1 || true

# --- TLS (deployed-only; script lands with issue #63) --------------------
if [[ ! -f scripts/check-tls.sh ]]; then
  echo "[tls]        skip: scripts/check-tls.sh not present yet (issue #63)"
elif [[ -n "${TLS_TARGET_URL:-}" ]]; then
  echo "[tls]        -> $OUT/tls.txt"
  bash scripts/check-tls.sh >"$OUT/tls.txt" 2>&1 || true
else
  echo "[tls]        skip: TLS_TARGET_URL not set (deployed-only)"
fi

echo "security-report: done."
