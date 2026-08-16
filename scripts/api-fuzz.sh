#!/usr/bin/env bash
#
# Property-based API fuzzing with Schemathesis, driven by the project's own
# OpenAPI document. Lives in a script (mirroring scripts/semgrep.sh) so the
# spec-generation, target selection, and graceful-skip logic all carry their
# justification.
#
# What it does:
#   1. Generates the OpenAPI spec to a temp file via
#      api/src/scripts/generate-openapi.ts (no DB/Redis needed for that step).
#   2. Targets a running API — API_TARGET_URL if set, otherwise it boots the
#      local API and waits for the health probe.
#   3. Runs `schemathesis run` against the live target.
#   4. Skips cleanly (exit 0) with an install hint when schemathesis is absent,
#      and when a local boot cannot be brought up.
#
# Usage:
#   API_TARGET_URL=https://staging-api.example.com bash scripts/api-fuzz.sh
#   bash scripts/api-fuzz.sh            # boots the local API itself
#
# Env:
#   API_TARGET_URL             Base origin of a running API (skips local boot).
#   SCHEMATHESIS_MAX_EXAMPLES  Hypothesis examples per operation (default 50).
#   SCHEMATHESIS_ARGS          Extra args appended verbatim to `schemathesis run`.
#   BOOT_TIMEOUT_SECONDS       How long to wait for a local boot (default 40).
set -euo pipefail

# --- Graceful skip: schemathesis is a Python tool, not an npm dep. -----------
if ! command -v schemathesis >/dev/null 2>&1; then
  echo "schemathesis not found on PATH — skipping API fuzzing." >&2
  echo "Install it with: pipx install schemathesis   (or) pip install schemathesis" >&2
  exit 0
fi

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

MAX_EXAMPLES="${SCHEMATHESIS_MAX_EXAMPLES:-50}"
BOOT_TIMEOUT="${BOOT_TIMEOUT_SECONDS:-40}"

# Resolve a tsx runner (workspace binary preferred, npx fallback).
if [[ -x "${REPO_ROOT}/node_modules/.bin/tsx" ]]; then
  TSX=("${REPO_ROOT}/node_modules/.bin/tsx")
else
  TSX=(npx --yes tsx)
fi

SPEC_FILE="$(mktemp -t livechat-openapi.XXXXXX)"
BOOT_PID=""

# shellcheck disable=SC2329 # invoked indirectly via the EXIT trap below.
cleanup() {
  [[ -n "$BOOT_PID" ]] && kill "$BOOT_PID" 2>/dev/null || true
  rm -f "$SPEC_FILE"
}
trap cleanup EXIT

# --- 1. Determine the target and generate the spec against it. ---------------
if [[ -n "${API_TARGET_URL:-}" ]]; then
  BASE_ORIGIN="${API_TARGET_URL%/}"
  echo "Fuzzing existing API at ${BASE_ORIGIN}" >&2
else
  BASE_ORIGIN="http://localhost:${PORT:-3000}"
  echo "No API_TARGET_URL set — booting local API at ${BASE_ORIGIN}" >&2
fi

API_URL="$BASE_ORIGIN" "${TSX[@]}" api/src/scripts/generate-openapi.ts "$SPEC_FILE"

# The spec's server is <origin>/api/v1; point Schemathesis at the same base.
BASE_URL="${BASE_ORIGIN}/api/v1"
HEALTH_URL="${BASE_URL}/health"

# --- 2. Boot the local API when we are not targeting a remote one. -----------
if [[ -z "${API_TARGET_URL:-}" ]]; then
  npm --workspace api run start >/tmp/livechat-api-fuzz-boot.log 2>&1 &
  BOOT_PID=$!

  echo "Waiting up to ${BOOT_TIMEOUT}s for ${HEALTH_URL} ..." >&2
  booted="false"
  for _ in $(seq 1 "$BOOT_TIMEOUT"); do
    if ! kill -0 "$BOOT_PID" 2>/dev/null; then
      break # process died (almost always missing env / DB / Redis)
    fi
    if curl -fsS "$HEALTH_URL" >/dev/null 2>&1; then
      booted="true"
      break
    fi
    sleep 1
  done

  if [[ "$booted" != "true" ]]; then
    echo "Local API did not become healthy — skipping fuzz run." >&2
    echo "Provide a running target with API_TARGET_URL, or ensure MySQL/Redis" >&2
    echo "and the API env are available for a local boot. Boot log:" >&2
    tail -n 20 /tmp/livechat-api-fuzz-boot.log >&2 || true
    exit 0
  fi
  echo "Local API is healthy." >&2
fi

# --- 3. Run Schemathesis. ----------------------------------------------------
# `--checks all` runs every built-in check (status codes conform to the spec,
# response schema conformance, content-type conformance, server errors, etc.).
echo "Running Schemathesis (max ${MAX_EXAMPLES} examples/operation)..." >&2
# Not `exec` — the EXIT trap must still run to tear down a locally-booted API
# and remove the temp spec. Capture the exit code and propagate it.
rc=0
# shellcheck disable=SC2086 # SCHEMATHESIS_ARGS is an intentional word-split hook.
schemathesis run "$SPEC_FILE" \
  --base-url "$BASE_URL" \
  --checks all \
  --max-examples "$MAX_EXAMPLES" \
  ${SCHEMATHESIS_ARGS:-} || rc=$?

exit "$rc"
