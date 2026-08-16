#!/usr/bin/env bash
#
# Built-image vulnerability gate (Trivy). Builds the api / ui / widget container
# images from their Dockerfiles and runs `trivy image` against each, so shipped
# OS + application-dependency CVEs are caught before the image is deployed. This
# is the vulnerability half of the container story; scripts/trivy.sh handles the
# Dockerfile/IaC *misconfiguration* half (`trivy config`).
#
# Gate policy (issue #60, reconciled in security/thresholds.yaml):
#   - CRITICAL vulnerabilities FAIL the gate.
#   - HIGH vulnerabilities are REPORTED but do NOT fail (warn tier).
# Accepted CVEs carry a justification (and an `exp:` date) in .trivyignore,
# which Trivy reads from the repo root automatically.
#
# Requires both `docker` (to build the images) and `trivy` (to scan them). Both
# are external tools most contributors will not have locally, and the house
# architecture is "local gates first, CI as the safety net", so this script
# SKIPS with a clear message when either is absent and runs the real gate in CI,
# where .github/workflows/container-iac-scan.yml builds the images and installs
# Trivy. Set TRIVY_IMAGE_SKIP_BUILD=1 to scan pre-built images (CI reuses the
# images from an earlier build step this way).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if ! command -v trivy >/dev/null 2>&1; then
  echo "skip: trivy not installed — built-image vulnerability gate not run locally." >&2
  echo "      install: brew install trivy  (or see https://github.com/aquasecurity/trivy/releases)" >&2
  echo "      CI runs it via .github/workflows/container-iac-scan.yml." >&2
  exit 0
fi

if ! command -v docker >/dev/null 2>&1 || ! docker info >/dev/null 2>&1; then
  echo "skip: docker not available — cannot build images to scan locally." >&2
  echo "      CI builds api/ui/widget and scans them via container-iac-scan.yml." >&2
  exit 0
fi

# name : Dockerfile path. Build context is the repo root for all three (the
# Dockerfiles COPY from workspace roots), matching .do/app.yaml's source_dir: /.
IMAGES=(
  "api:api/Dockerfile"
  "ui:ui/Dockerfile"
  "widget:widget/Dockerfile"
)

status=0
for entry in "${IMAGES[@]}"; do
  name="${entry%%:*}"
  dockerfile="${entry##*:}"
  tag="livechat-${name}:trivy-scan"

  if [[ "${TRIVY_IMAGE_SKIP_BUILD:-0}" != "1" ]]; then
    echo "trivy-image: building ${tag} from ${dockerfile}"
    docker build -f "$dockerfile" -t "$tag" .
  fi

  echo "trivy-image: scanning ${tag} (report: HIGH+CRITICAL; gate: CRITICAL)"
  # Informational pass — surface HIGH and CRITICAL so HIGH is visible without
  # failing the gate (warn tier). Never fails (exit-code 0).
  trivy image --scanners vuln,secret --severity HIGH,CRITICAL \
    --exit-code 0 --no-progress "$tag" || true

  # Gate pass — fail only on CRITICAL vulnerabilities not accepted in
  # .trivyignore. `|| status=1` so all three images are scanned before we exit.
  if ! trivy image --scanners vuln --severity CRITICAL \
    --exit-code 1 --no-progress --quiet "$tag"; then
    echo "trivy-image: CRITICAL vulnerabilities in ${tag} — gate failed." >&2
    status=1
  fi
done

exit "$status"
