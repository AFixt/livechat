#!/usr/bin/env bash
#
# Docker Compose IaC-misconfiguration gate (KICS).
#
# WHY KICS AND NOT TRIVY/CHECKOV: neither Trivy nor Checkov evaluates
# docker-compose files. `trivy config` detects only Dockerfiles/K8s/Terraform/etc
# (it reports "supported files not found" for a compose file), and Checkov has no
# docker-compose framework in any current release — its `yaml` framework produces
# zero checks on a compose file. KICS (Checkmarx, Apache-2.0) has a dedicated
# DockerCompose query set, so it is the tool that actually scans these files. The
# Dockerfiles stay covered by Hadolint + Trivy `config` + Checkov; KICS covers the
# gap: docker-compose.yml and docker-compose.prod.yml.
#
# NOT SCANNED HERE: .do/app.yaml is a DigitalOcean App Platform spec, not a
# compose file — no off-the-shelf scanner (Trivy, Checkov, or KICS) has policies
# for it (KICS returns 0 results). Its only secret-shaped values are `${VAR}`
# refs / empty `type: SECRET` placeholders; authoritative secret detection across
# the whole tree is trufflehog's job (ADR-0008). It is therefore deliberately
# left out rather than scanned for show.
#
# Gate policy (issue #60, reconciled in security/thresholds.yaml): IaC
# misconfiguration FAILS on HIGH and CRITICAL. This is the documented deviation
# from #60's "warn HIGH" — misconfigurations are directly-fixable config, and the
# DockerCompose query set tops out at HIGH (no CRITICAL exists), so a
# CRITICAL-only gate would never fire. Vulnerability scanning keeps #60's
# fail-CRITICAL/warn-HIGH split (scripts/trivy-image.sh).
#
# KICS is normally run as a container; a `kics` binary is rarely installed
# locally. So this script prefers a `kics` on PATH, then falls back to the pinned
# checkmarx/kics image when docker is present, and otherwise SKIPS cleanly
# (local-gates-first). CI runs the same script via container-iac-scan.yml.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

KICS_IMAGE="checkmarx/kics:v2.1.20-alpine"

# Compose files to scan. Explicit so the gate never drifts onto unrelated YAML.
PATHS=(docker-compose.yml docker-compose.prod.yml)

# --- Accepted exceptions (kept in lockstep with security/exceptions.yaml) -----
# Every entry is a KICS query ID with its justification, mirroring how
# scripts/semgrep.sh annotates each --exclude-rule.
#
# a88baa34-e2ad-44ea-ad6f-8cac87bc7c71 — "Passwords And Secrets".
#   The only hits are the dev-only placeholder secrets in docker-compose.yml
#   (JWT_ACCESS_SECRET / JWT_REFRESH_SECRET / COOKIE_SECRET = `dev-*-change-me`)
#   that run the LOCAL stack and are explicitly labelled throwaway. Prod injects
#   real values at runtime (docker-compose.prod.yml / .do/app.yaml use `${VAR}`
#   refs / empty `type: SECRET`, never literals). Authoritative secret detection
#   is trufflehog's job (ADR-0008 + the two-tier scan in #82), backed by semgrep
#   `p/secrets`. Catalogued as `kics-compose-dev-secrets` in exceptions.yaml.
#   Revisit: 2027-02-16.
EXCLUDE_QUERIES="a88baa34-e2ad-44ea-ad6f-8cac87bc7c71"

# Fail on HIGH and CRITICAL; MEDIUM/LOW/INFO are reported but do not block.
FAIL_ON="high,critical"

# Assemble the runner (native binary, or the pinned image). KICS syntax is
# `kics scan -p <path> ... <flags>`, so `scan` comes first, then the -p flags.
cmd=()
prefix=""
if command -v kics >/dev/null 2>&1; then
  cmd=(kics scan)
elif command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
  cmd=(docker run --rm -v "$ROOT":/repo "$KICS_IMAGE" scan)
  prefix="/repo/" # paths are relative to the mount inside the container
else
  echo "skip: kics not installed and docker unavailable — compose IaC gate not run locally." >&2
  echo "      install: see https://docs.kics.io/latest/getting-started/  (or install docker)" >&2
  echo "      CI runs it via .github/workflows/container-iac-scan.yml." >&2
  exit 0
fi

for p in "${PATHS[@]}"; do cmd+=(-p "${prefix}${p}"); done
cmd+=(--type DockerCompose --exclude-queries "$EXCLUDE_QUERIES" --fail-on "$FAIL_ON" --no-progress)

echo "kics: scanning ${PATHS[*]} (fail-on ${FAIL_ON})"
exec "${cmd[@]}"
