#!/usr/bin/env bash
# check-generated-specs.sh — fail when the committed Playwright specs do not
# match what `npm run usecases:generate` produces (ADR-0002: generated specs
# are committed, never hand-edited).
#
# Run AFTER `npm run usecases:generate`. Reports three kinds of drift:
#   - a tracked spec whose regenerated content differs (modified)
#   - a spec the generator produced that was never committed (untracked)
#   - a committed spec the generator no longer produces (deleted)
#
# Why not `git diff --quiet -- '**/e2e/generated/'`? Two reasons, both of which
# made the previous check incapable of failing (#149):
#   1. Without `:(glob)` magic, git treats `*` as fnmatch that does not cross
#      `/`, so `**/e2e/generated/` matched no file at all.
#   2. `git diff` never reports untracked files, so a brand-new spec was
#      invisible under any pathspec.
# `git status --porcelain` over literal directory paths covers all three cases.
set -euo pipefail

# Output directories of the usecases:generate:* scripts in package.json.
GENERATED_DIRS=(ui/e2e/generated widget/e2e/generated)

drift=$(git status --porcelain --untracked-files=all -- "${GENERATED_DIRS[@]}")

if [ -z "$drift" ]; then
  echo "Generated Playwright specs are in sync with usecases/."
  exit 0
fi

echo "::error::Generated Playwright specs are out of sync with usecases/."
echo "Run 'npm run usecases:generate' locally and commit the result."
echo
echo "$drift"
echo
git --no-pager diff -- "${GENERATED_DIRS[@]}" | head -60
exit 1
