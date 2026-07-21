# ADR-0008: Replace gitleaks with trufflehog for secret scanning

- **Status:** Accepted
- **Date:** 2026-07-21
- **Deciders:** Karl Groves

## Context

ADR-0001 (issue #1) adopted `gitleaks` as the secret scanner at the pre-commit
hook, in the `security:secrets` npm script (run at pre-push and in CI), and as a
bootstrap-installed binary. Issue #3 proposes switching to
[`trufflehog`](https://github.com/trufflesecurity/trufflehog).

ADR-0001 set a ground rule: don't replace an existing tool unless the new one is
a demonstrably higher-quality outcome, and record the decision as an ADR. This
is that record.

## Decision

Replace `gitleaks` with `trufflehog` everywhere it was wired:

- **`security:secrets` script (enforced at pre-push + CI):**
  `trufflehog git file://. --results=verified --fail --no-update` — scans the
  full local git history and fails (exit 183) only on **verified** secrets.
- **`.husky/pre-commit`:** trufflehog has no staged-diff mode equivalent to
  `gitleaks protect --staged`, so the hook scans the working-tree content of the
  staged files (`git diff --cached --name-only --diff-filter=ACM` →
  `trufflehog filesystem … --results=verified --fail --no-update`). The
  authoritative full-history verified scan still runs at pre-push and in CI.
- **`scripts/bootstrap.sh`:** installs `trufflehog` (brew, else the official
  install script) instead of `gitleaks`.
- **`.github/workflows/ci.yml`:** installs the `trufflehog` binary via the
  official install script so `npm run check:all` → `security:secrets` runs it,
  matching how `osv-scanner` is installed (local-gates-first architecture).

We use `--results=verified` rather than the issue's suggested `--only-verified`
because the latter is deprecated in trufflehog v3.95+; both express the same
"fail only on confirmed-live credentials" intent.

## Rationale

- **Verification cuts false positives.** trufflehog actively verifies detected
  credentials against live services, so the gate fails on real, live secrets
  rather than regex look-alikes.
- **Detector coverage.** 800+ verified detectors vs. gitleaks' regex rules.
- **Licensing.** The gitleaks GitHub Action requires a paid license for
  organization use; trufflehog is fully open source (AGPL).
- **Maintenance.** Frequent detector updates and a larger contributor base.

## Consequences

- Pre-commit protection is slightly different in shape: it scans staged file
  contents rather than the staged diff. Verified-only means an unverifiable but
  real secret (e.g. an internal token with no reachable verifier) can pass the
  gate — accepted, because the full-history scan plus semgrep's `p/secrets`
  rules and `eslint-plugin-no-secrets` provide defense in depth.
- CI and contributors no longer need `gitleaks`; `bootstrap.sh` installs
  `trufflehog`. No `.gitleaks.toml` existed, so none was removed.
- Supersedes the `gitleaks` choice in ADR-0001 (issue #1). Closes issue #3.
