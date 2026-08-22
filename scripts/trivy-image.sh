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

# The ui and widget builds install workspace devDependencies, which include
# private `@afixt/*` packages, so their `npm ci` needs registry auth (#130).
# Pass the npmrc as a BuildKit secret — never a build arg, which would persist
# in the image layers and `docker history`. `actions/setup-node` writes a
# runner-local npmrc and points NPM_CONFIG_USERCONFIG at it; locally this is
# the developer's own ~/.npmrc.
NPMRC="${NPM_CONFIG_USERCONFIG:-$HOME/.npmrc}"
build_secret=()
if [[ -f "$NPMRC" ]]; then
  build_secret=(--secret "id=npmrc,src=$NPMRC")
else
  echo "trivy-image: no npmrc at ${NPMRC} — the ui/widget builds will fail on" >&2
  echo "            the private @afixt/* packages. api is unaffected." >&2
fi

status=0
unbuilt=()
for entry in "${IMAGES[@]}"; do
  name="${entry%%:*}"
  dockerfile="${entry##*:}"
  tag="livechat-${name}:trivy-scan"

  if [[ "${TRIVY_IMAGE_SKIP_BUILD:-0}" != "1" ]]; then
    echo "trivy-image: building ${tag} from ${dockerfile}"
    # A build failure must not abort the run: under `set -e` the first
    # unbuildable image would silently deny every later image a scan, which is
    # how ui and widget went unscanned for so long behind a known-red api
    # build (#130). Record it, keep going, and fail at the end.
    if ! DOCKER_BUILDKIT=1 docker build "${build_secret[@]}" -f "$dockerfile" -t "$tag" .; then
      echo "trivy-image: BUILD FAILED for ${tag} — not scanned." >&2
      unbuilt+=("$name")
      status=1
      continue
    fi
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

# Never let a build failure read as a clean scan: say plainly which images were
# not covered, so a red run cannot be mistaken for "the gate passed for what
# matters".
if (( ${#unbuilt[@]} > 0 )); then
  echo "trivy-image: NOT SCANNED (build failed): ${unbuilt[*]}" >&2
fi

exit "$status"
