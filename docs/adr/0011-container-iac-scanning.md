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

Adopt four complementary, open-source scanners, wired the same way the rest of
the security stack is — a `scripts/*.sh` wrapper per tool that holds the
justified exceptions, an npm `security:*` script, membership in the aggregate
`security` script (except the image build, see below), and a PR-time CI job as
the safety net. Each tool is used **only for the artifacts it actually
evaluates** — an important correction from this change:

| Tool | Scans (verified) | Config | Runner | npm |
| --- | --- | --- | --- | --- |
| **Hadolint** | the three Dockerfiles (lint) | `.hadolint.yaml` | `scripts/hadolint.sh` | `security:hadolint` |
| **Trivy `config`** | the three Dockerfiles (misconfig) | `trivy.yaml` + `.trivyignore` | `scripts/trivy.sh` | `security:trivy` |
| **Trivy `image`** | the built api/ui/widget **images** (vuln + secret) | CLI flags + `.trivyignore` | `scripts/trivy-image.sh` | `security:trivy:image` |
| **Checkov** | the three Dockerfiles (IaC) | `.checkov.yaml` | `scripts/checkov.sh` | `security:checkov` |
| **KICS** | `docker-compose.yml`, `docker-compose.prod.yml` (IaC misconfig) | `scripts/kics.sh` | `scripts/kics.sh` | `security:kics` |

**Why KICS.** Neither Trivy nor Checkov evaluates docker-compose files. `trivy
config` recognises only Dockerfiles/Kubernetes/Terraform/etc. and reports
"supported files not found" for a compose file; Checkov has no docker-compose
framework in any current release, and its `yaml` framework yields zero checks on
a compose file. KICS (Checkmarx, Apache-2.0) has a dedicated DockerCompose query
set, so it is the tool that genuinely scans these files (verified: it produces
real HIGH/MEDIUM/INFO findings and fails on a seeded misconfiguration).

**`.do/app.yaml` is deliberately not structurally scanned.** It is a
DigitalOcean App Platform spec, not compose/Terraform/etc.; no off-the-shelf
scanner (Trivy, Checkov, or KICS) has policies for it — KICS returns 0 results.
Its only secret-shaped values are `${VAR}` references / empty `type: SECRET`
placeholders, and repo-wide secret detection is trufflehog's job (ADR-0008). We
do not scan it "for show".

**Built-image vulnerability scanning** (`trivy image`) builds the api/ui/widget
images and scans each for OS + dependency CVEs. Because it builds three images
it is **not** in the parallel local `security` aggregate (it would surprise
`npm run security` / pre-push with multi-minute builds); it runs in CI and is
available on demand via `npm run security:trivy:image` (needs docker + trivy).

### Threshold policy (issue #60)

Issue #60 sets "fail CRITICAL, warn HIGH". That split is applied where it
belongs — **vulnerability** scanning (`trivy image`), where HIGH base-image CVEs
are frequently transitive/unpatchable noise: CRITICAL fails, HIGH is reported
but does not block. For **misconfiguration** scanning (Hadolint / Trivy `config`
/ Checkov / KICS) HIGH is fail-closed: misconfigurations are directly-fixable
config defects, and the IaC tools emit few/no CRITICALs (KICS's DockerCompose
set tops out at HIGH), so a CRITICAL-only gate would never fire. This deviation
is intentional and recorded in `security/thresholds.yaml`.

Each runner degrades gracefully: when its tool is absent it skips with a clear
install hint and exits 0, exactly like the `trufflehog` pre-commit hook (KICS
additionally falls back to its pinned Docker image when the binary is absent but
docker is present). The real gate runs in
`.github/workflows/container-iac-scan.yml` at PR time (and on pushes to
`main`/`master`/`develop`), **not** on a schedule — consistent with issue #50
moving cron jobs to PR-time and CLAUDE.md's "no scheduled Actions" rule.

Checkov is a Python tool, installed via `pipx`/`pip` inside its runner, never as
an npm dependency — so it stays clear of the axe-core-banned Node tree
(`npm ls axe-core` is unaffected).

Findings fixed in this change: a `HEALTHCHECK` was added to all three
Dockerfiles (Checkov CKV_DOCKER_2 / Trivy AVD-DS-0026).

## Consequences

- Dockerfile misconfigurations, built-image vulnerabilities, and docker-compose
  misconfigurations now surface at PR time and locally via `npm run security`
  (image vulns via `npm run security:trivy:image`).
- KICS's DockerCompose set reports the two compose files' MEDIUM/INFO hygiene
  gaps (no healthcheck / memory limit / `security_opt`, host-bound ports) as
  non-blocking warnings — real signal without failing the gate on the local dev
  stack.
- More external tools for a full local run. All degrade gracefully (skip when
  absent; KICS via docker), and CI installs/uses them, so contributors are not
  forced to install anything.
- Accepted exceptions are documented once per tool, carry an expiry/revisit date
  (`exp:` in `.trivyignore`; `revisit:` comments elsewhere), and are catalogued
  with an owner in `security/exceptions.yaml`. The nginx-image non-root deferral
  appears as Hadolint `DL3002`, Trivy `AVD-DS-0002`, and Checkov `CKV_DOCKER_3`,
  each cross-referencing the others; the dev-secret placeholders in
  `docker-compose.yml` are excluded from KICS's secret query and covered by
  trufflehog instead.

## Alternatives considered

- **Trivy or Checkov for compose** — rejected because neither actually scans
  docker-compose files (verified empirically); claiming they did was the defect
  this ADR revision corrects. KICS is the tool that does.
- **Custom Checkov/KICS policies for `.do/app.yaml`** — rejected as
  over-engineering; the DO spec's only sensitive values are env placeholders
  already covered by trufflehog. Documented as out of structural scope instead.
- **Docker Scout / Snyk** — richer, but Scout is tied to Docker Hub and Snyk's
  useful tiers are paid; the house rule (ADR-0001) prefers fully open-source
  tooling.
- **Scheduled workflow** — rejected; issue #50 and CLAUDE.md move security scans
  to PR-time so findings block the change that introduced them.

## Links

- Issue #60; security-baseline program #59–65, #82–84
- ADR-0001 (tooling stack), ADR-0008 (trufflehog), ADR-0010 (mutable action tags)
- `scripts/hadolint.sh`, `scripts/trivy.sh`, `scripts/trivy-image.sh`,
  `scripts/checkov.sh`, `scripts/kics.sh`
- `security/thresholds.yaml`, `security/exceptions.yaml` (#65 governance)
- `.github/workflows/container-iac-scan.yml`
