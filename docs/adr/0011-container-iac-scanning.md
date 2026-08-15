# ADR-0011: Container, Dockerfile, and IaC scanning (Hadolint, Trivy, Checkov)

- **Status:** Accepted
- **Date:** 2026-08-15
- **Deciders:** Karl Groves

## Context

Issue #60 (part of the security-baseline program, #59–65 + #82–84) noted that
the repository ships three Dockerfiles (`api/`, `ui/`, `widget/`) and four IaC
artifacts (`docker-compose.yml`, `docker-compose.prod.yml`, `.do/app.yaml`) with
**no** container-image, Dockerfile, or infrastructure-as-code scanning. The
existing security stack (ADR-0001, ADR-0008, ADR-0010) covers dependency
advisories (`npm audit`, `osv-scanner`), static analysis (`semgrep`), secret
scanning (`trufflehog`), and CodeQL — but nothing looks at the container/IaC
layer, where root users, missing health checks, and misconfigured compose
services live.

## Decision

Adopt three complementary, best-in-class open-source scanners, wired the same
way the rest of the security stack is — a `scripts/*.sh` wrapper per tool that
holds the justified exceptions, an npm `security:*` script, membership in the
aggregate `security` script, and a PR-time CI job as the safety net:

- **Hadolint** — Dockerfile linter. Config `.hadolint.yaml`, runner
  `scripts/hadolint.sh`, script `security:hadolint`.
- **Trivy** — container image + filesystem + IaC misconfiguration scanner.
  Config `trivy.yaml`, accepted findings in `.trivyignore`, runner
  `scripts/trivy.sh`, script `security:trivy`.
- **Checkov** — IaC scanner over the Dockerfiles, `docker-compose*.yml`, and
  (via its secrets framework) `.do/app.yaml`. Config `.checkov.yaml`, runner
  `scripts/checkov.sh`, script `security:checkov`.

Each runner degrades gracefully: when its binary is absent it skips with a clear
install hint and exits 0, exactly like the `trufflehog` pre-commit hook. The
real gate runs in `.github/workflows/container-iac-scan.yml` at PR time (and on
pushes to `main`/`master`/`develop`), **not** on a schedule — consistent with
issue #50 moving cron jobs to PR-time and CLAUDE.md's "no scheduled Actions"
rule.

Checkov is a Python tool, installed via `pipx`/`pip` inside its runner, never as
an npm dependency — so it stays clear of the axe-core-banned Node tree
(`npm ls axe-core` is unaffected).

Findings fixed in this change: a `HEALTHCHECK` was added to all three
Dockerfiles (Checkov CKV_DOCKER_2 / Trivy AVD-DS-0026).

## Consequences

- Container/IaC misconfigurations now surface at PR time and locally via
  `npm run security`.
- Three more external binaries for a full local `security` run. They are
  optional locally (graceful skip) and installed in CI, so contributors are not
  forced to install them.
- Accepted exceptions are documented once per tool and kept in lockstep: the
  nginx-image non-root deferral appears as Hadolint `DL3002`, Trivy
  `AVD-DS-0002`, and Checkov `CKV_DOCKER_3`, each cross-referencing the others.

## Alternatives considered

- **Trivy alone** — Trivy covers Dockerfile + IaC misconfig and image vulns, but
  Hadolint gives sharper, Dockerfile-specific lint rules and Checkov gives
  deeper docker-compose/IaC policy coverage. Defense in depth across the three
  is cheap since each is a thin wrapper.
- **Docker Scout / Snyk** — richer, but Scout is tied to Docker Hub and Snyk's
  useful tiers are paid; the house rule (ADR-0001) prefers fully open-source
  tooling.
- **Scheduled workflow** — rejected; issue #50 and CLAUDE.md move security scans
  to PR-time so findings block the change that introduced them.

## Links

- Issue #60; security-baseline program #59–65, #82–84
- ADR-0001 (tooling stack), ADR-0008 (trufflehog), ADR-0010 (mutable action tags)
- `scripts/hadolint.sh`, `scripts/trivy.sh`, `scripts/checkov.sh`
- `.github/workflows/container-iac-scan.yml`
