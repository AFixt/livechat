#!/usr/bin/env bash
#
# TLS/HTTPS verification harness for DEPLOYED environments.
#
# The app ships to DigitalOcean App Platform (docs/deploy.md, .do/app.yaml) on
# the api.* / console.* / widget.* subdomains. There is no TLS to inspect on a
# local dev box or in a PR sandbox, so this is a DEPLOYED-ONLY check: with no
# target configured it is a clear no-op that exits 0, and local/PR runs never
# fail spuriously. Point it at staging or production by setting TLS_TARGET_URL
# (or passing a URL/host as the first argument).
#
# Checks (each independent; any failure exits non-zero so CI can gate on it):
#   1. testssl.sh — full protocol/cipher/cert/known-CVE audit. Invoked only if
#      the binary is present, otherwise skipped with an install hint. We do NOT
#      vendor it — same graceful-degradation contract as scripts/semgrep.sh:
#      the tool is external, and the gate degrades to a clear skip when it is
#      absent rather than exploding the run.
#   2. HTTP -> HTTPS redirect — a permanent 301/308 to an https:// Location.
#   3. HSTS — Strict-Transport-Security present with a sane max-age and
#      includeSubDomains.
#   4. Secure cookie flags — Secure, HttpOnly, and SameSite on every
#      Set-Cookie the origin emits.
#
# Env knobs:
#   TLS_TARGET_URL     target URL/host (or pass it as $1).
#   TLS_HSTS_MIN_AGE   minimum acceptable HSTS max-age in seconds
#                      (default 15552000 = 180 days, the hstspreload.org floor).
#   TESTSSL_SEVERITY   testssl.sh recording threshold (default HIGH). The gate
#                      fails on any HIGH/CRITICAL finding in testssl's output.
#
set -euo pipefail

# ---- configuration -------------------------------------------------------

HSTS_MIN_AGE="${TLS_HSTS_MIN_AGE:-15552000}"
TESTSSL_SEVERITY="${TESTSSL_SEVERITY:-HIGH}"

# ---- target resolution ---------------------------------------------------

TARGET="${1:-${TLS_TARGET_URL:-}}"

if [[ -z "$TARGET" ]]; then
  cat <<'MSG'
check-tls: no target configured — skipping (this is a deployed-only check).
  Set TLS_TARGET_URL (or pass a host/URL as the first argument) to run it
  against staging or production, e.g.:
    TLS_TARGET_URL=https://api.livechat.afixt.com npm run security:tls
MSG
  exit 0
fi

if ! command -v curl >/dev/null 2>&1; then
  echo "check-tls: curl is required for the redirect/HSTS/cookie checks but was not found." >&2
  exit 2
fi

# Normalize: accept "host", "host:port", "https://host/path", etc. Header
# checks probe the origin root, so any path/query on the input is dropped.
case "$TARGET" in
  http://* | https://*) URL="$TARGET" ;;
  *) URL="https://$TARGET" ;;
esac
hostport="${URL#*://}"
hostport="${hostport%%/*}"
HTTPS_URL="https://$hostport"
HTTP_URL="http://$hostport"

echo "check-tls: verifying $HTTPS_URL"
echo

failures=0
fail() {
  echo "  FAIL: $*" >&2
  failures=$((failures + 1))
}
pass() { echo "  ok:   $*"; }
skip() { echo "  skip: $*"; }

# One header fetch of the HTTPS origin feeds both the HSTS and cookie checks.
https_headers="$(curl -sS --max-time 20 -D - -o /dev/null "$HTTPS_URL" 2>/dev/null)" || {
  fail "could not connect to $HTTPS_URL"
  https_headers=""
}

# ---- 1. HTTP -> HTTPS redirect ------------------------------------------

echo "[1/4] HTTP -> HTTPS redirect"
redirect_headers="$(curl -sS --max-time 20 -D - -o /dev/null "$HTTP_URL" 2>/dev/null)" || redirect_headers=""
status="$(printf '%s\n' "$redirect_headers" | awk 'NR==1{print $2}')"
location="$(printf '%s\n' "$redirect_headers" | grep -i '^location:' | head -1 | tr -d '\r' | sed 's/^[Ll]ocation:[[:space:]]*//')" || true
if [[ ("$status" == "301" || "$status" == "308") && "$location" == https://* ]]; then
  pass "HTTP $status -> $location"
elif [[ ("$status" == "302" || "$status" == "307") && "$location" == https://* ]]; then
  fail "redirects to HTTPS but with a temporary status $status (want a permanent 301/308)"
else
  fail "no permanent HTTP->HTTPS redirect (status='${status:-none}', location='${location:-none}')"
fi

# ---- 2. HSTS -------------------------------------------------------------

echo "[2/4] HSTS (Strict-Transport-Security)"
hsts="$(printf '%s\n' "$https_headers" | grep -i '^strict-transport-security:' | head -1 | tr -d '\r')" || true
if [[ -z "$hsts" ]]; then
  fail "no Strict-Transport-Security header on $HTTPS_URL"
else
  max_age="$(printf '%s\n' "$hsts" | grep -oiE 'max-age=[0-9]+' | head -1 | grep -oE '[0-9]+')" || true
  if [[ -z "$max_age" ]]; then
    fail "HSTS header present but has no max-age: $hsts"
  elif ((max_age < HSTS_MIN_AGE)); then
    fail "HSTS max-age=$max_age is below the ${HSTS_MIN_AGE}s minimum"
  else
    pass "HSTS max-age=$max_age (>= $HSTS_MIN_AGE)"
  fi
  if printf '%s\n' "$hsts" | grep -qi 'includeSubDomains'; then
    pass "HSTS includeSubDomains present"
  else
    fail "HSTS missing includeSubDomains"
  fi
fi

# ---- 3. Secure cookie flags ---------------------------------------------

echo "[3/4] Secure cookie flags"
set_cookies="$(printf '%s\n' "$https_headers" | grep -i '^set-cookie:' | tr -d '\r')" || true
if [[ -z "$set_cookies" ]]; then
  skip "no Set-Cookie headers on $HTTPS_URL (nothing to check)"
else
  while IFS= read -r line; do
    [[ -z "$line" ]] && continue
    name="$(printf '%s' "$line" | sed -E 's/^[Ss]et-[Cc]ookie:[[:space:]]*([^=]+)=.*/\1/')"
    missing=()
    printf '%s' "$line" | grep -qiE '(;|[[:space:]])secure([[:space:]]|;|$)' || missing+=("Secure")
    printf '%s' "$line" | grep -qiE '(;|[[:space:]])httponly([[:space:]]|;|$)' || missing+=("HttpOnly")
    printf '%s' "$line" | grep -qiE 'samesite=(strict|lax|none)' || missing+=("SameSite")
    if [[ ${#missing[@]} -eq 0 ]]; then
      pass "cookie '$name' has Secure, HttpOnly, SameSite"
    else
      fail "cookie '$name' missing: ${missing[*]}"
    fi
  done <<<"$set_cookies"
fi

# ---- 4. testssl.sh deep TLS audit ---------------------------------------

echo "[4/4] testssl.sh TLS audit"
testssl_bin=""
for c in testssl.sh testssl; do
  if command -v "$c" >/dev/null 2>&1; then
    testssl_bin="$c"
    break
  fi
done
if [[ -z "$testssl_bin" ]]; then
  skip "testssl.sh not installed — skipping the deep TLS audit."
  echo "        Install it (not vendored here): https://github.com/testssl/testssl.sh"
  echo "        e.g. 'brew install testssl' or clone the repo and put testssl.sh on PATH,"
  echo "        then re-run. It audits protocols, ciphers, cert chain, and known TLS CVEs."
else
  testssl_json="$(mktemp)"
  trap 'rm -f "$testssl_json"' EXIT
  # --jsonfile gives a machine-readable result we can gate on regardless of
  # testssl's own exit code; --severity limits what it records/prints.
  "$testssl_bin" --quiet --severity "$TESTSSL_SEVERITY" --jsonfile "$testssl_json" "$HTTPS_URL" || true
  hits="$(grep -oiE '"severity"[[:space:]]*:[[:space:]]*"(HIGH|CRITICAL)"' "$testssl_json" 2>/dev/null | wc -l | tr -d ' ')" || true
  if [[ "${hits:-0}" -gt 0 ]]; then
    fail "testssl.sh reported ${hits} HIGH/CRITICAL finding(s) — see output above / $testssl_json"
  else
    pass "testssl.sh found no HIGH/CRITICAL findings"
  fi
fi

# ---- verdict -------------------------------------------------------------

echo
if ((failures > 0)); then
  echo "check-tls: ${failures} check(s) failed for $HTTPS_URL" >&2
  exit 1
fi
echo "check-tls: all checks passed for $HTTPS_URL"
