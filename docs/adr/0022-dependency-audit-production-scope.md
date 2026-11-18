# ADR-0022: Scope the dependency-audit gates to production dependencies

- **Status:** Accepted
- **Date:** 2026-11-17
- **Deciders:** Karl Groves

## Context

Two gates in the pre-push `check:all` scan dependencies for known advisories:
`security:audit` (`scripts/npm-audit.sh`, blocks on high and critical) and
`security:osv` (osv-scanner, blocks on any advisory not in `osv-scanner.toml`).
Both read the whole tree, dev tooling included.

In November 2026 picomatch GHSA-fc5q-39xc-vjpf (high) arrived with no fixed
release: 4.0.7 is both the last affected version and the latest. picomatch is
reached here only through lint, build and test tooling. Both gates failed on
every push, develop included, and nothing in this repository could clear them
except an open-ended suppression. That is the outcome
[ADR-0011](0011-security-baseline-governance.md) exists to prevent.

On 2026-11-17 Karl ruled fleet-wide that pre-push dependency-audit gates scan
production dependencies only.

## Decision

- `security:audit` runs `npm audit --omit=dev` across the workspaces and the
  root.
- `security:osv` runs `scripts/osv-production.sh`, which scans a copy of
  `package-lock.json` with every entry npm marks `"dev": true` removed. Entries
  marked `devOptional` or `optional` stay in scope, because a production path
  can reach them.
- `security/thresholds.yaml` records the scope as `scope: production` on both
  gates. No block-versus-warn threshold changes.

## Consequences

- A dev-only advisory no longer blocks a push. The gates fail only on code that
  ships in the api, ui or widget runtime.
- An advisory in dev tooling is no longer reported by any gate.
  `npm run security:report` still scans the full lockfile and writes
  `security-reports/osv.json`, so it stays visible on demand.
- An exception for a dev-only package becomes inert. osv-scanner lists it as an
  unused ignore but does not fail on it. Retire such exceptions through the
  registry in `security/exceptions.yaml` rather than leaving them to expire.
- `scripts/osv-production.sh` depends on npm's lockfile `dev` flags. If a future
  npm changes that format, the script must change with it.

## Alternatives considered

- **`npm sbom --omit=dev --package-lock-only` fed to osv-scanner**, as other
  fleet repos do. Rejected: measured on 2026-11-17 with npm 10.9, it drops real
  production packages from this workspace monorepo (zod, react, react-dom,
  preact, socket.io-client; `widget/` and `shared/` came out with no
  dependencies). A scan built on it would read green while skipping code that
  ships.
- **Suppress picomatch in both allow-lists until a fix ships.** Rejected: it has
  no fixed release to adopt, so the suppression would have no honest expiry, and
  the next dev-only advisory without a fix would need the same again.

## Links

- [ADR-0011](0011-security-baseline-governance.md) — security-baseline
  governance
- [`docs/security/README.md`](../security/README.md)
- PR #206
