# ADR-0005: Observability, budgets, and scheduled scanning

- **Status:** Accepted
- **Date:** 2026-04-24
- **Deciders:** Karl Groves

## Context

Phase 9 of the livechat plan calls for shipping the product with real
observability and quality gates — pino logs with correlation IDs end-to- end,
Lighthouse CI budgets, `size-limit` enforcement, OWASP ZAP baseline scans on a
schedule, and a load-test scenario. Issue #1's tooling stack already prescribed
most of these; this ADR locks in the specific thresholds and cadences so future
contributors can tell at a glance what "green" means.

## Decision

### Logging (pino)

- API emits **structured JSON to stdout** in production via `pino`.
  `pino-pretty` is dev-only. The runtime environment (DO App Platform, later)
  captures stdout.
- Every request gets a correlation ID, set by `correlationMiddleware` and
  attached to the response via the `x-correlation-id` header. Inbound clients
  can pass their own ID; we honor it unchanged so logs can be correlated across
  the widget, UI, and API tiers.
- Redact list: `authorization`, `cookie`, `x-xsrf-token`, `password`,
  `password_hash`, `token`, `refreshToken`, `accessToken`. Applied in
  `createLogger`; never turn off.

### Lighthouse CI

- `.lighthouserc.json` locks in the phase-9 budgets. Thresholds:
  - Performance category ≥ 90 (error)
  - SEO category ≥ 90 (error)
  - Best-practices category ≥ 90 (error)
  - FCP ≤ 1.8s (error)
  - LCP ≤ 2.5s (error)
  - CLS ≤ 0.1 (error)
  - INP ≤ 200ms (warn — desktop-preset approximates, real field data trumps
    this)
  - TBT ≤ 300ms (error)
- **Accessibility category is deliberately excluded.** That coverage belongs to
  `@afixt/a11y-assert` at the component + Playwright layers (ADR-0002).
  Lighthouse's a11y scoring is coarser and would produce noisy false positives.
- Runs on every PR + weekly schedule via `.github/workflows/lhci.yml`. Reports
  upload to Lighthouse's temporary-public-storage so reviewers can open the
  actual trace without running it locally.

### Size budgets (`size-limit`)

- **Widget**: 50 KB brotli (enforced today; actual is 20 KB).
- **UI initial JS**: 350 KB brotli (enforced today; actual is 215 KB). Assumes
  MUI + emotion are the dominant cost and tree-shaking covers unused components;
  bump only with an ADR. No separate CSS budget — MUI ships as runtime
  CSS-in-JS, so styles roll up into the JS bundle rather than a separate static
  asset.
- Budgets run in `npm run check:all` (pre-push) AND in `ci.yml` so web-UI merges
  can't bypass them.

### Load test (Artillery)

- `scripts/load/visitor-burst.yml` — REST-only scenario: widget init →
  customer-initiated chat → heartbeat. 200 rps sustained for 2 minutes.
- Not wired into CI; run locally against a real stack.
- Socket.IO load testing deferred — tracked in the load-test README. Targets
  (p95 message delivery < 500ms, 1k visitors + 50 staff per tenant, 30 min
  sustained) need a dedicated engine plugin.

### OWASP ZAP baseline

- Weekly on Tuesdays via `.github/workflows/zap.yml`.
- Target URL comes from `vars.ZAP_TARGET_URL` (repo variable) or the
  workflow_dispatch input. Skipped (with a warning) when neither is set — the
  workflow is designed to co-exist with pre-deploy repos.
- `fail_action: true` — a Medium+ finding fails the scheduled run and auto-files
  an issue via `allow_issue_writing: true`.
- Rule tuning in `.github/zap/rules.tsv` starts empty; every override must land
  with a comment explaining why.

## Consequences

**Easier:**

- Quality regressions are caught by three independent gates (pre-push
  `check:all`, per-PR `ci.yml`, weekly scheduled workflows) without requiring
  contributors to install Docker or a browser locally.
- "What's our FCP target?" has a single canonical answer in
  `.lighthouserc.json`.

**Harder:**

- Every significant performance or bundle regression will block a PR and needs a
  thought-out response (fix it, raise the budget with an ADR, or suppress with
  an explicit reason). That's the point.
- ZAP requires a publicly-reachable URL to scan. Pre-deploy, the workflow
  no-ops; keep `ZAP_TARGET_URL` set the moment a staging URL exists.

## Alternatives considered

- **k6 instead of Artillery** — rejected; Artillery's YAML diffs better in PR
  review and the team has no need for k6's distributed mode yet.
- **Datadog / New Relic for APM** — rejected; pre-revenue project. DO's native
  log capture + Grafana on top of the log stream is sufficient for the first
  year. Revisit when we have paying tenants.
- **Include Lighthouse accessibility category** — rejected; our a11y coverage
  lives in `@afixt/a11y-assert` at the component + Playwright layers (ADR-0002).
  Lighthouse's rule set is coarser and would duplicate work while producing
  false positives our stricter gate already prevents.

## Links

- `.lighthouserc.json`
- `.github/workflows/lhci.yml`
- `.github/workflows/zap.yml`
- `scripts/load/visitor-burst.yml`
- `scripts/load/README.md`
- GitHub issue #1 (tooling stack)
- requirements.md §4.1 (performance as a core requirement)
