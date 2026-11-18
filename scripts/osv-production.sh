#!/usr/bin/env bash
#
# OSV scan over the PRODUCTION dependency tree only. Exposed as
# `npm run security:osv`, so it runs in `npm run security` and the pre-push
# `check:all`.
#
# Karl's fleet ruling, 2026-11-17: pre-push dependency-audit gates scan
# production dependencies only. osv-scanner has no --omit=dev flag and reads
# every package in package-lock.json, so a dev-only advisory with no fixed
# release (picomatch GHSA-fc5q-39xc-vjpf, reached only through lint/build
# tooling) blocked every push from this repository, develop included.
#
# Other fleet repos feed osv-scanner `npm sbom --omit=dev --package-lock-only`.
# That does NOT work in this workspace monorepo: measured 2026-11-17 with npm
# 10.9, the SBOM silently drops real production packages (zod, react,
# react-dom, preact, socket.io-client; widget/ and shared/ came out with no
# dependencies at all) — a production scan that skipped them would read green
# while missing exactly what ships.
#
# So the production set comes from the lockfile itself: npm marks every package
# that only dev dependencies reach with `"dev": true`, and this script copies
# package-lock.json without those entries, then runs osv-scanner on the copy.
# Everything else stays in scope, including optional and devOptional packages
# (devOptional means a production path can reach it too). The copy keeps the
# name package-lock.json so osv-scanner recognises the format, and --config is
# passed explicitly because osv-scanner looks for osv-scanner.toml next to the
# scanned file, which here is a temp file.
set -euo pipefail

cd "$(dirname "$0")/.."

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

node -e '
const fs = require("node:fs");
const lock = JSON.parse(fs.readFileSync("package-lock.json", "utf8"));
const kept = {};
let dropped = 0;
for (const [path, info] of Object.entries(lock.packages || {})) {
  if (info.dev === true) dropped += 1;
  else kept[path] = info;
}
lock.packages = kept;
fs.writeFileSync(process.argv[1], JSON.stringify(lock));
console.log(`osv-production: scanning ${Object.keys(kept).length} production lockfile entries (${dropped} dev-only entries left out).`);
' "$tmp/package-lock.json"

osv-scanner --config=osv-scanner.toml --lockfile="$tmp/package-lock.json"
