#!/usr/bin/env bash
# ci-usecases-gate.sh — enforce ADR-0002 ("every user interaction is
# documented in the usecase DSL") on pull requests.
#
# Rules:
#   1. If any *.tsx/*.ts under ui/src/pages/ ui/src/components/
#      ui/src/layouts/ widget/src/states/ widget/src/app.tsx
#      widget/src/components/ changes, at least one usecases/*.uc.yaml
#      file must also change.
#   2. Test files (*.test.*, *.spec.*), style-only CSS edits, and
#      service-layer changes are exempt — they don't alter observable
#      user-facing behavior by themselves.
#   3. If a label `skip-usecases` is present on the PR, skip the check
#      entirely. (The label is also written to the PR body or passed
#      via the SKIP_USECASES env var for local testing.)
#   4. Fail fast with a clear message pointing contributors to
#      docs/adr/0002-usecase-dsl-mandate.md.
set -euo pipefail

BASE="${1:-${GITHUB_BASE_SHA:-origin/main}}"
HEAD="${2:-${GITHUB_HEAD_SHA:-HEAD}}"

if [ "${SKIP_USECASES:-}" = "1" ]; then
  echo "SKIP_USECASES=1 set — gate bypassed."
  exit 0
fi

changed=$(git diff --name-only "$BASE" "$HEAD")

# Files that require a matching uc.yaml change (real UX surfaces only)
ux_changed=$(echo "$changed" | grep -E '^(ui|widget)/src/(pages|states|components|layouts|app)\.(tsx?|jsx?)$|^(ui|widget)/src/(pages|states|components|layouts)/' || true)
# Strip test files
ux_changed=$(echo "$ux_changed" | grep -vE '\.(test|spec)\.(tsx?|jsx?)$' || true)

uc_changed=$(echo "$changed" | grep -E '^usecases/' || true)

if [ -z "$ux_changed" ]; then
  echo "No user-facing UI changes — gate passes."
  exit 0
fi

if [ -n "$uc_changed" ]; then
  echo "UI changes include matching usecases/ updates — gate passes."
  echo "---"
  echo "$ux_changed" | sed 's/^/  ui: /'
  echo "$uc_changed" | sed 's/^/  uc: /'
  exit 0
fi

cat <<EOF >&2
::error::UI changed without a matching update under usecases/.

Per docs/adr/0002-usecase-dsl-mandate.md, every user-facing interaction in
this product must be documented as a \`.uc.yaml\` file consumable by
@afixt/usecase-runner. When you change a page / state / component that
affects what the user sees, update (or add) a usecase under usecases/
and re-run \`npm run usecases:generate\`.

Changed UI files that require a usecase:
$(echo "$ux_changed" | sed 's/^/  - /')

Emergency escape hatch: add the \`skip-usecases\` label to this PR OR set
SKIP_USECASES=1 in the CI env. Use sparingly — every bypass is a gap
in the usecase contract.
EOF
exit 1
