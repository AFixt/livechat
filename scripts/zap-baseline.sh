#!/usr/bin/env bash
#
# Local OWASP ZAP baseline (DAST) — the same scan the `zap-pr` job in
# .github/workflows/zap.yml runs, without GitHub Actions (#205).
#
# What it does, mirroring that job step for step:
#   1. Builds shared, api, ui and widget (`npm run build`) unless
#      ZAP_SKIP_BUILD=1.
#   2. Serves ui/dist through the SHIPPED nginx config (ui/nginx.conf) in the
#      same nginx base image the job uses, so a header finding means a header is
#      genuinely absent rather than a harness difference (#131).
#   3. Runs zap-baseline.py from the official ZAP image against it, with the
#      job's rules file (.github/zap/rules.tsv) and the job's options
#      (`-a -j -I`): WARN reports, FAIL fails.
#
# The job runs ZAP with --network=host and scans localhost; that does not reach
# the host on Docker Desktop (macOS/Windows), so here both containers join a
# throwaway Docker network and ZAP scans nginx by container name. No host port
# is published, so nothing collides with a running dev server.
#
# Set ZAP_TARGET_URL to scan an already-running deployment instead (the
# `zap-deployed` job's manual mode): no build, no nginx. For a server on this
# machine use http://host.docker.internal:<port> — `localhost` inside the ZAP
# container is the container itself.
#
# Exit status is zap-baseline's: 0 clean, 1 a FAIL-tier rule fired, 3 ZAP
# itself failed. Docker absent: skip (exit 0) locally, the house pattern for
# tool-dependent gates; fail under CI, where a silent skip would be a gate
# that can never go red.
#
# Not part of `npm run security` or the pre-push `check:all`: it pulls a ~1 GB
# image and the AJAX spider takes minutes. Run it before merging anything that
# touches ui/nginx.conf, the console's headers, or .github/zap/rules.tsv.
#
# Usage:
#   npm run security:zap
#   ZAP_SKIP_BUILD=1 npm run security:zap          # reuse an existing ui/dist
#   ZAP_TARGET_URL=https://staging.example.com npm run security:zap
#
# Env:
#   ZAP_TARGET_URL   Scan this URL instead of a local build.
#   ZAP_SKIP_BUILD   1 = do not run `npm run build` (ui/dist must exist).
#   ZAP_IMAGE        ZAP image (default ghcr.io/zaproxy/zaproxy:stable, which is
#                    what zaproxy/action-baseline runs).
#   ZAP_NGINX_IMAGE  nginx image (default nginx:1.27-alpine, as in the job and
#                    ui/Dockerfile's runtime stage).
#   ZAP_REPORT_DIR   Where the HTML and Markdown reports go
#                    (default reports/zap, git-ignored).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

ZAP_IMAGE="${ZAP_IMAGE:-ghcr.io/zaproxy/zaproxy:stable}"
NGINX_IMAGE="${ZAP_NGINX_IMAGE:-nginx:1.27-alpine}"
REPORT_DIR="${ZAP_REPORT_DIR:-$ROOT/reports/zap}"
RULES_FILE="$ROOT/.github/zap/rules.tsv"
# The job's cmd_options. -a alpha passive rules, -j AJAX spider (the console is
# a SPA), -I a WARN does not fail the run so the rules.tsv tiers mean something.
ZAP_OPTIONS=(-a -j -I)

if ! command -v docker >/dev/null 2>&1 || ! docker info >/dev/null 2>&1; then
  if [[ -n "${CI:-}" ]]; then
    echo "zap-baseline: docker is not available, and CI is set — failing rather" >&2
    echo "              than reporting a DAST scan that never ran." >&2
    exit 1
  fi
  echo "skip: docker not available — ZAP baseline not run locally." >&2
  echo "      Start Docker and re-run: npm run security:zap" >&2
  exit 0
fi

if [[ ! -f "$RULES_FILE" ]]; then
  echo "zap-baseline: missing $RULES_FILE" >&2
  exit 1
fi

SUFFIX="$$-${RANDOM}"
NETWORK="livechat-zap-${SUFFIX}"
TARGET_CONTAINER="livechat-zap-ui-${SUFFIX}"
WORK_DIR="$(mktemp -d -t livechat-zap.XXXXXX)"
network_created=""
target_started=""

# shellcheck disable=SC2329 # invoked indirectly via the EXIT trap below.
cleanup() {
  if [[ -n "$target_started" ]]; then
    docker rm -f "$TARGET_CONTAINER" >/dev/null 2>&1 || true
  fi
  if [[ -n "$network_created" ]]; then
    docker network rm "$NETWORK" >/dev/null 2>&1 || true
  fi
  rm -rf "$WORK_DIR"
}
trap cleanup EXIT

# ZAP reads the rules file from, and writes its reports to, /zap/wrk. Give it a
# scratch copy rather than mounting .github/zap writable. The image runs as the
# `zap` user, whose uid will not match ours on Linux, hence the open mode;
# sticky, so another local user cannot swap rules.tsv in a shared /tmp.
cp "$RULES_FILE" "$WORK_DIR/rules.tsv"
chmod 1777 "$WORK_DIR"
chmod 0644 "$WORK_DIR/rules.tsv"

network_args=()
if [[ -n "${ZAP_TARGET_URL:-}" ]]; then
  TARGET="$ZAP_TARGET_URL"
  echo "zap-baseline: scanning existing deployment ${TARGET}" >&2
else
  if [[ "${ZAP_SKIP_BUILD:-}" != "1" ]]; then
    echo "zap-baseline: building (npm run build)..." >&2
    npm run build
  fi
  if [[ ! -f "$ROOT/ui/dist/index.html" ]]; then
    echo "zap-baseline: ui/dist/index.html not found — run npm run build first." >&2
    exit 1
  fi

  # Each flag is set BEFORE its command: a create or start that fails part way
  # still leaves a network or a `Created` container behind, and cleanup's
  # removals already tolerate a name that does not exist.
  network_created=1
  docker network create "$NETWORK" >/dev/null
  network_args=(--network "$NETWORK")

  echo "zap-baseline: serving ui/dist through ui/nginx.conf (${NGINX_IMAGE})" >&2
  target_started=1
  docker run -d --name "$TARGET_CONTAINER" "${network_args[@]}" \
    -v "$ROOT/ui/nginx.conf:/etc/nginx/conf.d/default.conf:ro" \
    -v "$ROOT/ui/dist:/usr/share/nginx/html:ro" \
    "$NGINX_IMAGE" >/dev/null

  # Wait for nginx from inside the network, which is where ZAP will be.
  ready=""
  for _ in $(seq 1 30); do
    if docker exec "$TARGET_CONTAINER" wget -q -O /dev/null http://127.0.0.1/ 2>/dev/null; then
      ready=1
      break
    fi
    sleep 1
  done
  if [[ -z "$ready" ]]; then
    echo "zap-baseline: UI target did not become ready" >&2
    docker logs "$TARGET_CONTAINER" >&2 || true
    exit 1
  fi
  TARGET="http://${TARGET_CONTAINER}"
fi

echo "zap-baseline: running ${ZAP_IMAGE} zap-baseline.py -t ${TARGET} ${ZAP_OPTIONS[*]}" >&2
rc=0
# The ${a[@]+...} form: bash 3.2 (macOS) treats an empty array as unset under
# `set -u`, which is the ZAP_TARGET_URL case.
docker run --rm ${network_args[@]+"${network_args[@]}"} \
  -v "$WORK_DIR:/zap/wrk:rw" \
  "$ZAP_IMAGE" \
  zap-baseline.py -t "$TARGET" -c rules.tsv "${ZAP_OPTIONS[@]}" \
  -r zap-report.html -w zap-report.md || rc=$?

mkdir -p "$REPORT_DIR"
for report in zap-report.html zap-report.md; do
  if [[ -f "$WORK_DIR/$report" ]]; then
    cp "$WORK_DIR/$report" "$REPORT_DIR/$report"
  fi
done
echo "zap-baseline: reports in ${REPORT_DIR}" >&2

if [[ "$rc" -ne 0 ]]; then
  echo "zap-baseline: ZAP exited ${rc} (1 = a FAIL-tier rule fired, 3 = ZAP error)" >&2
fi
exit "$rc"
