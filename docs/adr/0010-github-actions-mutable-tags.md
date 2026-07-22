# ADR-0010: Keep mutable major tags for GitHub Actions; drop OWASP Dependency-Check

- **Status:** Accepted
- **Date:** 2026-07-22
- **Deciders:** Karl Groves

## Context

Semgrep's `github-actions-mutable-action-tag` rule flags every `uses:` reference
that points at a mutable tag (`actions/checkout@v4`, `github/codeql-action@v3`,
…) — 19 findings across the workflows. A tag can be repointed by the action
owner, or by anyone who compromises that account, so a pinned tag is not a
pinned artifact. The standard mitigation is to pin every action to a full commit
SHA.

That mitigation assumes something keeps the pins current. **Dependabot is
disabled in this repo and will stay disabled** (PR #22). Without a bumper, SHA
pinning has a cost the rule doesn't account for:

- Every action freezes at the commit pinned on the day of the change.
- Security and bug fixes published by the action author never arrive.
- Bumping is a manual chore that, realistically, will not happen on a schedule.

Weighed against that, the actions in use are all from GitHub itself
(`actions/*`, `github/codeql-action/*`) or established organisations
(`lycheeverse`, `zaproxy`). For those publishers, a mutable **major** tag is the
channel through which patches are delivered.

One reference was different in kind:
`dependency-check/Dependency-Check_Action@main` pointed at a **branch**, not a
version — it moved with every upstream commit, with no release discipline at
all. That action's most recent release is 1.1.0 (April 2021).

## Decision

1. **Keep mutable major tags** for GitHub Actions. Do not pin to commit SHAs
   while there is no automated bumper. Receiving upstream security fixes is
   judged the larger benefit; the residual tag-repointing risk from
   GitHub-official and established publishers is accepted.
2. **Drop the OWASP Dependency-Check job** from `.github/workflows/security.yml`
   rather than pinning it. It was the only branch (`@main`) reference, it is
   effectively unmaintained (last release 2021), and for a pure npm/TypeScript
   monorepo it adds little over the `npm audit`, `osv-scanner`, and CodeQL scans
   already running — Dependency-Check is primarily a Java/native CVE tool.
3. The `github-actions-mutable-action-tag` exclusion in `scripts/semgrep.sh`
   therefore stays, and is justified by this ADR rather than left as an
   undecided suppression.

## Consequences

- The semgrep secret/SAST gate stays green without re-litigating 19 findings
  each run; the exclusion now carries a documented rationale.
- Action versions track their major tags, so upstream fixes land automatically
  and CI breakage from a bad upstream release is possible — acceptable, since CI
  failures are visible immediately and the blast radius is the build, not
  production.
- Dependency scanning coverage is unchanged in practice: `npm audit`
  (`--audit-level=high`), `osv-scanner` against `package-lock.json`, and weekly
  CodeQL all remain.
- **Revisit if Dependabot is ever re-enabled** — with a bumper in place, SHA
  pinning becomes the better trade and this ADR should be superseded.
