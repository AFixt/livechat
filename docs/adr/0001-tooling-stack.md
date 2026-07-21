# ADR-0001: Adopt the issue #1 tooling stack wholesale

- **Status:** Accepted
- **Date:** 2026-04-24
- **Deciders:** Karl Groves

## Context

This repo is greenfield. AFixt has a standardized tooling spec in GitHub issue
[#1](https://github.com/AFixt/livechat/issues/1) ("Adopt standardized quality,
security, a11y, and performance tooling stack") that is being rolled out across
AFixt projects. Other active projects (help-desk, meetabl, revenant, officea11y)
are migrating toward it from various legacy states — CommonJS + Jest in some
cases, CRA in others. Because livechat has no legacy to preserve, we adopt the
target stack in full from day one.

## Decision

Adopt the tooling stack described in issue #1 verbatim:

- TypeScript everywhere with `strict` + `noUncheckedIndexedAccess` +
  `exactOptionalPropertyTypes` + `noImplicitOverride`;
  `@total-typescript/ts-reset` imported in each workspace
- Flat ESLint config (`eslint.config.js`) with the full plugin set:
  `@typescript-eslint/strict-type-checked` + `stylistic-type-checked`, `react`,
  `react-hooks`, `react-refresh`, `jsx-a11y`, `sonarjs`, `security`, `unicorn`,
  `import-x`, `promise`, `n`, `jsdoc`, `no-secrets`
- Prettier with `prettier-plugin-organize-imports`
- Stylelint with `@double-great/stylelint-a11y`
- `markdownlint-cli2`
- `jscpd`, `lychee`, `license-checker-rseidelsohn`
- Vitest (unit + integration), Playwright (E2E), supertest (API routes), msw
  (HTTP mocking)
- `@afixt/a11y-assert` at component, E2E, and CI-preview layers
- `size-limit` and Lighthouse CI budgets
- Security: `npm audit`, `osv-scanner`, `semgrep` (OWASP Top 10), `trufflehog`
  (secret scanning — superseded `gitleaks`, see ADR 0008), weekly CodeQL, weekly
  OWASP Dependency-Check
- Husky hooks as primary gate (pre-commit, commit-msg, pre-push, post-merge);
  GitHub Actions as safety net only
- Express hardening: `helmet`, `express-rate-limit`, `express-slow-down`,
  restrictive `cors`, `zod` for all input validation, `envalid` for env vars,
  `pino` for logging

## Consequences

**Easier:**

- Uniform quality floor with other AFixt projects as they migrate
- Fast local feedback via Husky; low GitHub Actions spend
- Strict types + Zod schemas + enforced TSDoc reduce the amount of code future
  maintainers (and Claude) need to read

**Harder:**

- Contributors need local binaries (semgrep, osv-scanner, trufflehog, lychee) —
  see `scripts/bootstrap.sh`
- Strict rules (300-line file cap, 75-line function cap, complexity 10) will
  push back early when files sprawl

**Commits:**

- Any deviation from issue #1 requires a superseding ADR

## Alternatives considered

- **Biome as a full replacement for ESLint + Prettier** — rejected; loses
  `jsx-a11y`, which is non-negotiable for this product.
- **Jest + CRA (help-desk/officea11y current state)** — rejected; issue #1 is
  the forward direction and we're greenfield.

## Links

- GitHub issue #1
- AFixt/help-desk issue #29 (tooling rollout tracker)
