#!/usr/bin/env bash
#
# Static analysis gate. Lives in a script rather than inline in package.json
# so every rule exclusion can carry its justification.
#
# Note: `p/express` used to be in this list. semgrep.dev retired it and now
# returns 404 for it, and semgrep exits 7 on an invalid config *before*
# scanning — so the gate silently never ran. If a ruleset below starts
# 404ing, that is the failure mode to look for.
set -euo pipefail

# Degrade gracefully when semgrep is not installed: this gate runs in local
# pre-push and in CI, but a contributor without semgrep on PATH should get a
# clear skip rather than a hard failure. CI installs semgrep, so coverage is
# not lost.
if ! command -v semgrep >/dev/null 2>&1; then
  echo "semgrep not found on PATH — skipping static-analysis gate." >&2
  echo "Install it with: pipx install semgrep   (or) brew install semgrep" >&2
  exit 0
fi

# Repo root, so the custom-rules --config resolves regardless of caller cwd.
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CUSTOM_RULES="${REPO_ROOT}/.semgrep/rules.yml"

CONFIGS=(
  --config=p/javascript
  --config=p/typescript
  --config=p/react
  --config=p/nodejsscan
  --config=p/owasp-top-ten
  --config=p/security-audit
  --config=p/secrets
)

# Project-specific rules (see .semgrep/rules.yml). Added only when present so
# the gate still runs on a checkout that predates the file.
if [[ -f "${CUSTOM_RULES}" ]]; then
  CONFIGS+=("--config=${CUSTOM_RULES}")
fi

EXCLUDES=(
  # False positive. Every hit is a `token === undefined` / `=== null`
  # presence check. The rule is about comparing secret material, where
  # early-exit reveals length; comparing against null reveals nothing.
  --exclude-rule=ajinabraham.njsscan.crypto.timing_attack_node.node_timing_attack

  # False positive. Hits are Sequelize `where: { token: input.token }`
  # clauses. The rule targets raw MongoDB query objects, where a
  # user-supplied object can smuggle operators like `$ne`. Sequelize
  # parameterizes these, and our inputs are Zod-validated scalars first.
  --exclude-rule=ajinabraham.njsscan.database.nosql_find_injection.node_nosqli_injection

  # Not findings. The njsscan `good` namespace matches *correct* usage —
  # these fire because api/src/app.ts configures helmet properly.
  --exclude-rule=ajinabraham.njsscan.good.good_helmet_checks.helmet_header_x_powered_by
  --exclude-rule=ajinabraham.njsscan.good.good_helmet_checks.helmet_header_dns_prefetch
  --exclude-rule=ajinabraham.njsscan.good.good_helmet_checks.helmet_header_hsts
  --exclude-rule=ajinabraham.njsscan.good.good_helmet_checks.helmet_header_ienoopen
  --exclude-rule=ajinabraham.njsscan.good.good_helmet_checks.helmet_header_nosniff
  --exclude-rule=ajinabraham.njsscan.good.good_helmet_checks.helmet_header_xss_filter

  # Was real, now fixed. The rule fires on any add_header inside a
  # location block and cannot tell whether the inherited headers were
  # repeated — which is the remedy it recommends, and what ui/nginx.conf
  # and widget/nginx.conf now do. If you add a location block that sets
  # add_header, repeat the server-block headers in it.
  --exclude-rule=generic.nginx.security.header-redefinition.header-redefinition

  # SHA-pinning of GitHub Actions vs. mutable tags (19 findings). Decided in
  # ADR-0010: keep mutable major tags. Pinning needs a bumper to stay current
  # and Dependabot is disabled by choice, so pinning would freeze the actions
  # and stop upstream security fixes. Revisit if Dependabot is re-enabled.
  --exclude-rule=yaml.github-actions.security.github-actions-mutable-action-tag.github-actions-mutable-action-tag

  # TLS on the DB connection is now implemented but env-driven (DB_SSL /
  # DB_SSL_CA in api/src/config/{env,mysql}.ts + db/config.cjs), because it
  # must stay off for local docker-compose. The rule matches the whole
  # Sequelize construction and cannot see that TLS is enabled at runtime via
  # env, so it can't be satisfied without forcing TLS unconditionally.
  # Production sets DB_SSL=true.
  --exclude-rule=ajinabraham.njsscan.database.sequelize_tls.sequelize_tls
)

# Never scan the rules dir itself: .semgrep/tests/ holds intentionally-insecure
# fixtures for `semgrep --test` that would otherwise trip both the registry
# packs and our own rules.
exec semgrep "${CONFIGS[@]}" "${EXCLUDES[@]}" --exclude='.semgrep' --error --metrics=off "$@"
