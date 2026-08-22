# ADR-0011: Security-baseline governance — central thresholds and an exception lifecycle

- **Status:** Accepted
- **Date:** 2026-08-15
- **Deciders:** AFixt engineering

> Numbering note: sibling security-baseline PRs (#59-65, #82-84) may each add an
> ADR concurrently. If another `0011-*.md` lands first, this record will be
> renumbered to the next free value on merge.

## Context

The security-baseline program (issues #59-65, #82-84) adds a fleet of scanners:
`npm audit`, `osv-scanner`, `semgrep`, `trufflehog`, a TLS/HTTPS harness, a
license allowlist, CodeQL, and — via sibling PRs — trivy, checkov, and an OWASP
ZAP baseline. Each tool already carried its own suppressions: `--exclude-rule`
entries in `scripts/semgrep.sh`, an `ALLOW` id in `scripts/npm-audit.sh`, an
`IgnoredVulns` block in `osv-scanner.toml`, and a placeholder
`.dependency-check-suppressions.xml`.

Two gaps made this ungovernable:

- **No lifecycle.** Every suppression carried a reason inline, but none carried
  an **owner** or an **expiry**. A suppression added as "temporary" had no
  mechanism to ever be revisited, so it lived forever silently.
- **No central policy.** What each tool blocks on versus warns on lived only in
  the scripts, undocumented and inconsistent. There was no one place to read
  "what does our security gate actually enforce?" and no index of the program as
  a whole.

See `CLAUDE.md` (Tooling → Security) and `requirements.md` §4.1.

## Decision

Add a governance layer over the scanners without changing what any scanner
detects:

1. **Central thresholds** — `security/thresholds.yaml` is the single source of
   truth for each gate's block-vs-warn severity. It documents the policy the
   scripts already encode; changing a threshold means editing both the file and
   the scanner's own config in the same PR.

2. **Exception registry with a lifecycle** — `security/exceptions.yaml`
   catalogues **every** accepted suppression across all tooling, each with
   `owner`, `reason`, `added`, and `expires`. The registry does not suppress
   anything itself (the suppression stays in each tool's own config, which is
   what the tool reads); it adds the governance metadata that config lacks.
   `scripts/check-exceptions.sh` (`npm run security:exceptions`, wired into the
   aggregate `npm run security`) **fails the gate** on any active exception past
   its `expires` date and warns on those expiring within 30 days.

3. **Report artifacts and an index** — `scripts/security-report.sh`
   (`npm run security:report`) writes machine-readable scanner output into a
   gitignored `security-reports/` directory, reusing each tool's owned config.
   `docs/security/README.md` indexes the whole program: the tools, how to run
   the suite, where reports land, and the threshold and exception policy.

Existing suppressions are **catalogued, not removed** — the registry is now the
agreed home for suppressions owned by other tools and sibling PRs, and is
updated as those land.

## Consequences

- A "temporary" suppression is warned on as its review date approaches and
  becomes a red build once that date has passed — the forcing function that
  keeps the exception set honest.
- Anyone can read the enforced policy in one file and the full suppression
  inventory in another; onboarding and audits get a single entry point.
- Small ongoing cost: adding a suppression now requires a second edit (the
  registry entry), and expiries must be renewed or retired on their date. This
  friction is deliberate.
- The registry and thresholds intentionally list tools that are not on `develop`
  yet (trivy, checkov, ZAP). Those rows stay `pending` until the sibling PRs
  wire them, so the policy is complete but not falsely enforcing.
- `check-exceptions.sh` parses the registry with Node line-scanning rather than
  a YAML dependency, keeping the gate install-free; this assumes the registry
  keeps its simple, documented block shape.

## Alternatives considered

- **Leave suppressions inline, add only docs.** Rejected — documentation with no
  expiry enforcement is exactly the status quo that let suppressions ossify.
- **A hosted policy/vuln-management platform (e.g. a SaaS triage tool).**
  Rejected — heavyweight for the repo's scale, adds an external dependency and
  account, and conflicts with the "local gates preferred over CI" house rule.
- **Encode thresholds directly in a schema the scripts read at runtime.**
  Rejected for now — the scripts already encode their thresholds correctly; a
  runtime-read config would be a larger refactor across scripts owned by other
  PRs. `thresholds.yaml` documents and centralizes the policy without that
  coupling, and can grow into a read-at-runtime source later.

## Links

- requirements.md §4.1 (accessibility-and-security tooling mandate)
- `security/thresholds.yaml`, `security/exceptions.yaml`
- `docs/security/README.md`, `docs/security/tls-verification.md` (issue #63)
- ADR-0010 (mutable GitHub Actions tags — one of the catalogued exceptions)
- GitHub issues #59-65, #82-84 (security-baseline program)
