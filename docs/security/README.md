# Security baseline

This directory documents the livechat **security-baseline program** (GitHub
issues #59-65 and #82-84): the set of automated scanners, their gate
thresholds, the exception lifecycle that governs their suppressions, and the
report artifacts they emit. This page is the index; the governance decision is
recorded in [ADR-0011](../adr/0011-security-baseline-governance.md).

## The tools

Everything below runs from the repo root. The gating scanners are wired into
`npm run security` (which `npm run check:all` runs on pre-push and in CI).

| Tool | npm script | Config / source | What it checks |
| --- | --- | --- | --- |
| npm audit | `security:audit` | `scripts/npm-audit.sh` | Known-vulnerable dependencies (high/critical). |
| osv-scanner | `security:osv` | `osv-scanner.toml` | OSV advisories against the lockfile. |
| semgrep | `security:semgrep` | `scripts/semgrep.sh` | SAST — OWASP Top Ten, Node/TS security rules. |
| trufflehog | `security:secrets` | `package.json` | Verified secrets in git history. |
| exception expiry | `security:exceptions` | `scripts/check-exceptions.sh` | Expired entries in the exception registry. |
| TLS/HTTPS | `security:tls` | `scripts/check-tls.sh` | Deployed transport security (deployed-only; lands with #63). |
| license allowlist | `license:check` | `package.json` | Production deps outside the SPDX allowlist. |
| CodeQL | — | `.github/workflows/security.yml` | Scheduled deep SAST (security-extended). |

Sibling PRs in the program (#82-84) add trivy, checkov, and an OWASP ZAP
baseline; they are catalogued in the threshold and exception files ahead of
landing so the policy is complete.

## Running the suite

```bash
# Full gating suite (fails on any blocking finding)
npm run security

# A single scanner
npm run security:semgrep

# Deployed-only TLS check (no-op unless a target is set) — see #63
TLS_TARGET_URL=https://api.livechat.afixt.com npm run security:tls
```

`npm run security` runs the gating scanners in parallel and exits non-zero if
any of them block. It is part of `npm run check:all`, so a red scanner blocks
pre-push and CI.

## Report artifacts

```bash
npm run security:report
```

`scripts/security-report.sh` runs the scanners in **report mode** and writes
machine-readable output into `security-reports/` (gitignored):

- `npm-audit.json`, `osv.json`, `semgrep.json` — raw scanner findings.
- `licenses.json` — production dependency license inventory.
- `exceptions-status.txt` — current exception-registry status.
- `tls.txt` — TLS check output (only when `TLS_TARGET_URL` is set).

This is separate from the gating run: the report generator never fails on
findings, so it is safe to run anywhere and to upload the directory as a CI job
artifact. Each scanner is optional — a missing binary is skipped with a note.

## Thresholds — what blocks vs warns

The single source of truth for gate severity is
[`security/thresholds.yaml`](../../security/thresholds.yaml). In short:

- **Blocks** (fails the gate): npm-audit high/critical, any un-ignored OSV
  advisory, semgrep `ERROR`-severity findings, any verified secret, any
  production license outside the allowlist, and — for a configured deployed
  target — any TLS/redirect/HSTS/cookie failure.
- **Warns** (surfaced, not blocking): npm-audit moderate/low, semgrep
  `WARNING`/`INFO`, unverified secret matches.

Changing a threshold means editing both `security/thresholds.yaml` and the
scanner's own config in the same PR, so the two never drift.

## Exception lifecycle

Every accepted suppression across all of the tooling is catalogued in
[`security/exceptions.yaml`](../../security/exceptions.yaml) with an **owner**,
**reason**, **added** date, and **expiry**. The registry does not itself
suppress anything — the suppression still lives in each tool's own config (that
is what the tool reads); the registry adds the governance metadata that config
lacks.

### Adding an exception

1. Add the suppression to the tool's own config with an inline justification
   (e.g. a `--exclude-rule` in `scripts/semgrep.sh`, an `IgnoredVulns` block in
   `osv-scanner.toml`, an `ALLOW` id in `scripts/npm-audit.sh`).
2. Add a matching entry to `security/exceptions.yaml` with `owner`, `reason`,
   `added`, `expires`, and `status: active`.
3. Prefer the shortest defensible expiry. Advisory allow-lists should align
   their `expires` with the tool's own ignore date (e.g. `osv-scanner.toml`'s
   `ignoreUntil`).

### Reviewing and expiring

```bash
npm run security:exceptions
```

`scripts/check-exceptions.sh` **fails the gate** on any active exception past
its `expires` date, and warns on any expiring within the next 30 days
(`EXCEPTION_WARN_DAYS`). On the review date, either remove the suppression (fix
the finding) or renew the entry with a fresh justification and a new expiry.
Because `security:exceptions` is part of `npm run security`, a lapsed exception
turns the build red by design — that is the forcing function that stops
"temporary" suppressions from becoming permanent.

## See also

- [`security/thresholds.yaml`](../../security/thresholds.yaml) — gate thresholds.
- [`security/exceptions.yaml`](../../security/exceptions.yaml) — exception registry.
- `docs/security/tls-verification.md` — deployed transport-security harness;
  lands with issue #63 (link once both PRs merge).
- [ADR-0011](../adr/0011-security-baseline-governance.md) — the governance
  decision.
