# ADR-0015: Two-tier secret scanning + false-positive baseline

- **Status:** Accepted
- **Date:** 2026-08-15
- **Deciders:** Karl Groves

## Context

Issue #82 (part of the security-baseline program, #59–65 + #82–84). ADR-0008
adopted trufflehog and wired it as `--results=verified --fail` everywhere
(pre-commit, pre-push, CI). Verified-only is an excellent **blocking** gate:
trufflehog confirms the credential is live against a real service, so
false-positive rate is near zero. But it is silent about the **suspected** tier
— a detector matched, yet verification could not confirm it: no reachable
verifier, an internal-only token, a rate-limited API, or a real secret that is
simply not verifiable. None of those ever reached a human. There was also no
recorded false-positive baseline and no `pre-commit`-framework config, so the
suspected tier could not be made actionable — it would be pure noise.

## Decision

Keep the verified tier as the sole **blocking** gate, and add a **suspected**
tier that **warns** without blocking, made actionable by a recorded
false-positive baseline.

- **`scripts/secret-scan.sh <tier>`** wraps trufflehog:
  - `verified` (default) — `--results=verified --fail`. Unchanged behaviour;
    this is what `security:secrets`, `security`, `check:all`, and pre-push run.
  - `suspected` — `--results=unverified,unknown`, **no** `--fail`; always
    exits 0. Wired as `security:secrets:suspected`. Both apply the path
    exclusions in **`.trufflehog-exclude.txt`** (native allow-list: test
    fixtures, lockfile, i18n strings — high-noise, no live credentials).
- **`.secrets.baseline`** (Yelp detect-secrets convention) records known
  candidate secrets at line granularity so the suspected tier surfaces only
  _new_ findings. **`scripts/detect-secrets.sh`** (`security:secrets:baseline`)
  re-scans against it and **warns** on drift, never blocks. detect-secrets runs
  via `pipx`/`pip`, never as an npm dependency — the axe-core-banned Node tree
  is untouched.
- **`.pre-commit-config.yaml`** wires the detect-secrets baseline hook and a
  verified-tier trufflehog hook for contributors who use the Python `pre-commit`
  framework. **husky remains THE enforced gate** (`npm install` wires husky, not
  `pre-commit`); this file is an optional, parallel path and the canonical home
  of the detect-secrets hook.
- **`.husky/pre-commit`** now runs both tiers on staged files: verified
  (blocking) then suspected (warn, never aborts the commit).

### Exception lifecycle for baseline entries

A `.secrets.baseline` entry (or a `.trufflehog-exclude.txt` path) is a recorded
false positive. To add one: confirm it is not a live credential, then in the
**same commit** regenerate/re-audit
(`detect-secrets scan --baseline .secrets.baseline` →
`detect-secrets audit .secrets.baseline`) and state **who / why** in the commit
message. Remove the entry when the fixture goes away. The verified (blocking)
tier is never suppressed by the baseline — only the warn tier is filtered — so a
mistaken allow-list entry can never hide a _confirmed-live_ secret.

## Consequences

- Suspected secrets are now visible (locally, at pre-commit, and in the PR-time
  `secret-scan.yml` workflow) without turning into a blocking, noisy gate.
- A committed baseline needs occasional re-auditing as fixtures change; drift is
  a warning, not a failure, so it never blocks a merge.
- Two secret tools now coexist by role: trufflehog for verification-based tiers,
  detect-secrets for the line-level false-positive baseline. Extends (not
  supersedes) ADR-0008.

## Alternatives considered

- **detect-secrets everywhere, dropping trufflehog** — rejected; trufflehog's
  live-verification is what makes the blocking tier near-zero-FP (ADR-0008).
- **trufflehog `--exclude-paths` only, no detect-secrets baseline** — rejected;
  whole-path exclusion is coarse, and the issue calls for a recorded, auditable,
  line-level baseline that a human reviews.
- **Make the suspected tier blocking** — rejected; unverified hits are noisy by
  nature, and a blocking noisy gate trains people to bypass it.

## Links

- Issue #82; security-baseline program #59–65, #82–84
- ADR-0008 (trufflehog secret scanning), ADR-0001 (tooling stack)
- `scripts/secret-scan.sh`, `scripts/detect-secrets.sh`,
  `.trufflehog-exclude.txt`, `.secrets.baseline`, `.pre-commit-config.yaml`,
  `.github/workflows/secret-scan.yml`
