#!/usr/bin/env bash
#
# Security-exception expiry gate.
#
# Reads security/exceptions.yaml (the catalogue of every accepted suppression
# across the repo's security tooling) and fails if any ACTIVE exception has
# passed its `expires` date. Warns on any expiring within the next
# EXCEPTION_WARN_DAYS days (default 30). This is the forcing function that keeps
# "temporary" suppressions from living forever — the review is a red gate, not a
# calendar reminder someone has to remember.
#
# Wired as `npm run security:exceptions` and into the aggregate `npm run
# security`. Parsing is done with Node (always present in this repo) rather than
# a YAML dependency, so the gate has no install step of its own — same
# graceful, dependency-light spirit as scripts/semgrep.sh and
# scripts/npm-audit.sh.
#
set -euo pipefail

REGISTRY="${EXCEPTIONS_FILE:-security/exceptions.yaml}"
WARN_DAYS="${EXCEPTION_WARN_DAYS:-30}"

if [[ ! -f "$REGISTRY" ]]; then
  echo "check-exceptions: no registry at $REGISTRY — nothing to check (skipping)."
  exit 0
fi

if ! command -v node >/dev/null 2>&1; then
  echo "check-exceptions: node is required to parse $REGISTRY but was not found." >&2
  exit 2
fi

REGISTRY="$REGISTRY" WARN_DAYS="$WARN_DAYS" node <<'NODE'
const fs = require("fs");

const file = process.env.REGISTRY;
const warnDays = parseInt(process.env.WARN_DAYS || "30", 10);
const lines = fs.readFileSync(file, "utf8").split(/\r?\n/);

// Minimal line-based parse: collect every "- id:" block and the status/tool/
// expires keys nested under it. No YAML lib needed for this fixed shape.
const clean = (v) => v.replace(/\s+#.*$/, "").replace(/^["']|["']$/g, "").trim();
const entries = [];
let cur = null;
for (const line of lines) {
  let m;
  if ((m = line.match(/^\s*-\s+id:\s*(.+?)\s*$/))) {
    cur = { id: clean(m[1]) };
    entries.push(cur);
  } else if (cur && (m = line.match(/^\s+status:\s*(.+?)\s*$/))) {
    cur.status = clean(m[1]);
  } else if (cur && (m = line.match(/^\s+tool:\s*(.+?)\s*$/))) {
    cur.tool = clean(m[1]);
  } else if (cur && (m = line.match(/^\s+expires:\s*(.+?)\s*$/))) {
    cur.expires = clean(m[1]);
  } else if (/^[A-Za-z]/.test(line)) {
    cur = null; // left the list; a new top-level key started
  }
}

const today = new Date();
today.setHours(0, 0, 0, 0);
const DAY = 86400000;

const expired = [];
const expiring = [];
let activeCount = 0;

for (const e of entries) {
  if (e.status !== "active") continue;
  activeCount++;
  if (!e.expires) {
    expired.push({ ...e, why: "active exception has no `expires` date" });
    continue;
  }
  const d = new Date(e.expires + "T00:00:00");
  if (isNaN(d.getTime())) {
    expired.push({ ...e, why: `unparseable expires date "${e.expires}"` });
    continue;
  }
  const days = Math.round((d - today) / DAY);
  if (days < 0) {
    expired.push({ ...e, why: `expired ${-days} day(s) ago (${e.expires})` });
  } else if (days <= warnDays) {
    expiring.push({ ...e, days });
  }
}

for (const e of expiring) {
  console.log(`  warn: ${e.id} [${e.tool || "?"}] expires in ${e.days} day(s) on ${e.expires}`);
}

if (expired.length) {
  console.error(`check-exceptions: ${expired.length} active exception(s) need review:`);
  for (const e of expired) console.error(`  FAIL: ${e.id} [${e.tool || "?"}] — ${e.why}`);
  console.error(
    "\nRenew each with a fresh justification + expiry in security/exceptions.yaml,\n" +
      "or remove the suppression from its tool config to fix the finding."
  );
  process.exit(1);
}

console.log(
  `check-exceptions: ${activeCount} active exception(s), none expired` +
    (expiring.length ? ` (${expiring.length} expiring within ${warnDays} days — see above)` : "") +
    "."
);
NODE
