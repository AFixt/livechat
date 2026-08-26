#!/usr/bin/env bash
# link-check.sh — run the Markdown link check, then keep only decided results
# in lychee's cache.
#
# lychee caches every result it reaches, including failures. That is fine for a
# 404, which stays a 404 — but a timeout or a connection error is written with
# an EMPTY status field (`url,,timestamp`, verified against lychee 0.23), and
# `--cache-exclude-status` only understands status codes between 100 and 999.
# So there is no way to tell lychee "do not cache a timeout".
#
# The consequence is worse than the flake itself. One slow response from a
# perfectly healthy host poisons `.lycheecache` for `max_cache_age`, and every
# later run then fails INSTANTLY with `Error (cached)` — with a generous
# `--timeout` and a live, working link. Observed 2026-08-26: web.archive.org
# answered in 9.8s, then timed out past 60s, then answered in 29.8s; the one
# timeout blocked every subsequent push until the row was deleted by hand.
#
# A pre-push gate that blocks pushes for reasons unrelated to the change being
# pushed teaches contributors to reach for --no-verify, and then it stops
# catching what it exists for. Issue #153 was the same failure mode from a
# different cause.
#
# Dropping the status-less rows costs one extra request on the next run and
# leaves the cache doing its job for the ~100 links that are fine. Coded
# failures are left to lychee's own `cache_exclude_status` in lychee.toml.
set -euo pipefail

CACHE=".lycheecache"

# Prune first: an earlier interrupted run can leave a poisoned row behind, and
# a stale one must not decide this run.
prune_undecided_rows() {
  [ -f "$CACHE" ] || return 0

  # Rows are `url,status,timestamp`. A URL may itself contain commas, so the
  # status is addressed from the end of the row, never as field 2.
  local pruned
  pruned=$(mktemp)
  awk -F, 'NF >= 3 && $(NF - 1) != ""' "$CACHE" >"$pruned"

  local before after
  before=$(wc -l <"$CACHE" | tr -d ' ')
  after=$(wc -l <"$pruned" | tr -d ' ')

  mv "$pruned" "$CACHE"

  if [ "$before" != "$after" ]; then
    echo "link-check: dropped $((before - after)) undecided (timeout/connection) row(s) from $CACHE"
  fi
}

prune_undecided_rows

status=0
lychee --no-progress '**/*.md' || status=$?

# Prune again, so a timeout in THIS run cannot decide the next one.
prune_undecided_rows

if [ "$status" -ne 0 ]; then
  echo "link-check: lychee reported unreachable links (exit $status)." >&2
  echo "link-check: timeouts are not cached, so re-running re-checks them live." >&2
fi

exit "$status"
