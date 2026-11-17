#!/usr/bin/env bash
#
# Dependency-vulnerability gate. Wraps `npm audit` so every accepted advisory
# carries its justification here — exactly like scripts/semgrep.sh does for
# static-analysis rules and osv-scanner.toml does for OSV findings.
#
# `npm audit` has no native per-advisory ignore, so we take its JSON, collect
# every high/critical advisory id in the tree, drop only the ids allow-listed
# below, and fail if anything else at/above the threshold remains. A brand-new
# advisory against a pinned dep therefore still turns the gate red — only the
# specific, justified, time-limited exceptions pass.
#
# Keep this list in lockstep with osv-scanner.toml.
set -euo pipefail

# Accepted advisories — id → why + review date.
#   GHSA-jmr9-qjv8-65gv  extract-zip 2.0.1 unvalidated symlink path traversal.
#     No fixed version exists (2.0.1 is still the latest published release,
#     re-checked 2026-11-17). Dev-only: ui > @size-limit/time > estimo, whose
#     puppeteer-core 24.22.0 and find-chrome-bin 2.0.4 both pin
#     @puppeteer/browsers 2.10.10 exactly — never in the production
#     api/ui/widget runtime. Tracked in #51. Revisit 2027-02-17: adopt a fixed
#     extract-zip once one ships, or an estimo on @puppeteer/browsers 3.x.
#   GHSA-7pqw-9j4j-h8q3  extract-zip 2.0.1 arbitrary file write through symlink
#     archive entries. Same package, same flaw class (CWE-22), same path in, same
#     lack of a fix as the entry above. The only archive extracted on that path
#     is the Chrome build @puppeteer/browsers downloads for estimo, not
#     attacker-supplied input. @puppeteer/browsers 3.x drops extract-zip, but
#     find-chrome-bin and estimo's puppeteer-core both pin 2.10.10 exactly.
#     Tracked in #51; same review date.
export ALLOW="GHSA-jmr9-qjv8-65gv,GHSA-7pqw-9j4j-h8q3"

tmp="$(mktemp)"
trap 'rm -f "$tmp"' EXIT

# npm audit exits non-zero when it finds anything; capture the report regardless.
npm audit --workspaces --include-workspace-root --json >"$tmp" 2>/dev/null || true

node -e '
const fs = require("fs");
const allow = new Set((process.env.ALLOW || "").split(",").map(s => s.trim()).filter(Boolean));
let data;
try { data = JSON.parse(fs.readFileSync(process.argv[1], "utf8")); }
catch (e) { console.error("npm-audit gate: could not parse npm audit JSON:", e.message); process.exit(2); }

const vulns = data.vulnerabilities || {};
const found = new Map(); // id -> a human label
for (const info of Object.values(vulns)) {
  for (const v of info.via || []) {
    if (v && typeof v === "object" && (v.severity === "high" || v.severity === "critical")) {
      const m = (v.url || "").match(/GHSA-[0-9a-z-]+/i);
      const id = m ? m[0] : (v.title || "unknown-advisory");
      found.set(id, `${v.severity}: ${v.name || "?"} — ${id}`);
    }
  }
}

const unaccepted = [...found.keys()].filter(id => !allow.has(id));
if (unaccepted.length) {
  console.error("npm-audit gate: unaccepted high/critical advisories:");
  for (const id of unaccepted) console.error("  " + found.get(id));
  console.error("\nFix them, or (only with a written justification) add the id to the allow-list in scripts/npm-audit.sh and osv-scanner.toml.");
  process.exit(1);
}
const accepted = [...found.keys()].filter(id => allow.has(id));
console.log("npm-audit gate: no high/critical advisories outside the documented allow-list" +
  (accepted.length ? " (accepted: " + accepted.join(", ") + ")" : "") + ".");
' "$tmp"
