#!/usr/bin/env bash
set -euo pipefail

need() { command -v "$1" >/dev/null 2>&1 || { echo "Missing: $1"; return 1; }; }

echo "Checking required tools..."

need node || { echo "Install Node via nvm (see .nvmrc)"; exit 1; }
need git || exit 1

if ! command -v semgrep >/dev/null 2>&1; then
  echo "Installing semgrep..."
  pip install --user semgrep || brew install semgrep || {
    echo "Install semgrep manually: https://semgrep.dev/docs/getting-started/"
    exit 1
  }
fi

if ! command -v osv-scanner >/dev/null 2>&1; then
  echo "Installing osv-scanner..."
  brew install osv-scanner 2>/dev/null || {
    echo "Install osv-scanner from https://github.com/google/osv-scanner/releases"
    exit 1
  }
fi

if ! command -v trufflehog >/dev/null 2>&1; then
  echo "Installing trufflehog..."
  brew install trufflehog 2>/dev/null \
    || curl -sSfL https://raw.githubusercontent.com/trufflesecurity/trufflehog/main/scripts/install.sh | sh -s -- -b /usr/local/bin \
    || {
    echo "Install trufflehog from https://github.com/trufflesecurity/trufflehog"
    exit 1
  }
fi

if ! command -v lychee >/dev/null 2>&1; then
  echo "Installing lychee..."
  brew install lychee 2>/dev/null || cargo install lychee || {
    echo "Install lychee from https://github.com/lycheeverse/lychee/releases"
    exit 1
  }
fi

# Container / Dockerfile / IaC scanners (ADR-0011, issue #60). Optional locally:
# scripts/{hadolint,trivy,checkov}.sh skip cleanly when these are absent, and CI
# installs them. Best-effort here — a failed install only warns, never aborts
# bootstrap, unlike the required tools above.
if ! command -v hadolint >/dev/null 2>&1; then
  echo "Installing hadolint (optional)..."
  brew install hadolint 2>/dev/null \
    || echo "warn: install hadolint from https://github.com/hadolint/hadolint/releases"
fi

if ! command -v trivy >/dev/null 2>&1; then
  echo "Installing trivy (optional)..."
  brew install trivy 2>/dev/null \
    || echo "warn: install trivy from https://github.com/aquasecurity/trivy/releases"
fi

if ! command -v checkov >/dev/null 2>&1; then
  echo "Installing checkov (optional)..."
  pipx install checkov 2>/dev/null || pip install --user checkov 2>/dev/null \
    || echo "warn: install checkov via 'pipx install checkov'"
fi

echo ""
echo "Installing npm dependencies..."
npm ci

echo ""
echo "All tools ready. Run 'npm run check:all' to verify."
