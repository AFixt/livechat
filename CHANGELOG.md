# Changelog

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Architecture decisions referenced below live in [`docs/adr/`](docs/adr/).

## [Unreleased]

_Nothing yet._

## [0.1.2] - 2026-07-23

A security release. The REST API enforced role but not tenant, so a
tenant-scoped operator could reach another tenant's data. Also makes the
coverage gate real rather than decorative.

### Security

- **The REST API now enforces tenant isolation.** A tenant-scoped `admin` or
  `staff` could read — and in places modify — another tenant's chats, users and
  tenants over HTTP: list endpoints filtered on a caller-supplied
  `?tenantId` (omitting it returned every tenant's rows), and by-id routes
  never compared the record's tenant to the caller's.
  `requireTenantAccess()` existed but was dead code, and would not have helped
  if wired up — it returned early for `super_admin`/`admin`/`staff`, so it only
  ever constrained `client`. Replaced with `callerTenantScope()`,
  `assertTenantAccess()` and `resolveTenantFilter()`, keyed on the caller's own
  `tenant_id` rather than their role, and applied across chats, users and
  tenants. Lists are pinned to the caller's tenant; naming another tenant is a
  403 rather than a silent rewrite. Untenanted AFixt staff still span every
  tenant, per the issue #19 decision. ([#43], [#44])

  The Socket.IO layer was already isolated, which is why this went unnoticed —
  one layer was tested and the adjacent one was not, the same shape as the
  migration drift fixed in 0.1.1.

### Fixed

- **The e2e stack no longer fails on a fresh MySQL volume.** The entrypoint's
  temporary init server accepts `CREATE DATABASE`, so the readiness gate could
  pass against it and the real server would then drop the seed's connection
  mid-migration (`PROTOCOL_CONNECTION_LOST`). Setup now waits for the init
  phase to complete before provisioning, and retries the seed. ([#44])

### Changed

- **Coverage thresholds are enforced.** `check:all` ran `test`, not
  `test:coverage`, so the 80/75/80/80 thresholds in `api/vitest.config.ts` were
  decorative and the project sat below its own bar. It now runs `test:ci`,
  which runs the api suite once under coverage; plain `npm test` stays fast for
  local work. Coverage went from 64.30/39.53/73.99/69.11 to
  93.24/80.89/98.64/96.65, with the api suite growing from 22 to 191 tests
  (197 including the isolation tests above). ([#42])

[#42]: https://github.com/AFixt/livechat/pull/42
[#43]: https://github.com/AFixt/livechat/issues/43
[#44]: https://github.com/AFixt/livechat/pull/44

## [0.1.1] - 2026-07-22

A correctness release. v0.1.0 shipped a database schema the ORM could not read
on six tables; this fixes that and closes the testing gap that let it through.

### Fixed

- **The widget could not start a chat.** `POST /api/v1/visitor/chats` returned
  500 with `Unknown column 'deleted_at' in 'field list'`. `paranoid: true` is a
  global Sequelize `define` default, so every model selects `deleted_at` and
  filters on it, but six `createTable` migrations never created the column —
  `visitor_sessions`, `chat_events`, `user_sessions`, `jwt_blacklist`,
  `audit_logs`, `staff_tenants`. Any read against those tables failed on a
  migration-created database. ([#37])
- **e2e stack failed to start on a fresh MySQL volume.** The readiness probe
  passed against the entrypoint's temporary init server, which then shut down
  before the real server started, so the next statement hit a dead socket and
  took the api webServer down with it. ([#38])

### Changed

- **Test schemas are built from the real migrations, not `sync({ force: true })`.**
  Both the API integration harness and the e2e seeder now drop every table and
  replay `api/src/db/migrations` via the new `api/src/db/migrator.ts`. Building
  from the models made the models the source of truth for both the code under
  test and the schema it ran against, so migration drift was structurally
  invisible — which is how the bug above shipped with every suite green.
  ([#38], [#39])
- **Integration tests actually run in CI.** The `check` job starts MySQL and
  Redis and runs with `REQUIRE_DB=1`, so an unreachable stack fails loudly.
  Previously the job had no database, every integration test returned early,
  and CI reported the same "22 passed" whether or not one existed. Local runs
  without the flag still skip, so `npm test` works with no Docker. ([#40])

### Added

- A static migration-drift guard (`api/tests/unit/migration-schema-drift.test.ts`)
  that replays the migrations and asserts each table ends up with the columns
  the global define defaults require. Needs no database. ([#37])
- `CHANGELOG.md`, and a README note on `@afixt/*` scoped packages and
  `NPM_TOKEN` (a 404 there is an auth failure, not a missing package).
  ([#35], [#36])

## [0.1.0] - 2026-07-22

First tagged release. Everything below had accumulated on `develop`; `master`
had never carried any of it. The product is pre-1.0 and not yet deployed.

### Added

- **Widget conversation states are reachable.** `no_support`,
  `support_initiated`, and `restart` were rendered but nothing ever dispatched
  to them. The widget now branches on staff availability when a visitor
  initiates, the support console can start a chat from the visitor presence
  list, and a returning visitor is offered to resume a prior conversation.
  ([#29], closes [#21])

### Fixed

- **Untenanted staff receive real-time events.** AFixt staff with no tenant of
  their own joined no `tenant:{id}` socket room, so the support console sat
  silent while visitors chatted. They now join a `staff:global` room that
  visitor and chat events are mirrored to; tenant-scoped agents remain isolated
  to their own tenant. ([#30], closes [#19])
- **Widget form-field borders are visible** — WCAG 1.4.11 non-text contrast.
- **Lockfile and CI drift** — excluded dead `output.jsbin.com` demo links from
  the lychee gate, which had been failing every pull request with zero real
  errors.

### Changed

- **Secret scanning: gitleaks → trufflehog.** The gate now fails only on
  *verified* credentials, and the trufflehog action is fully open source.
  (ADR-0008, [#28], closes [#3])
- **Database TLS is env-driven** — `DB_SSL` / `DB_SSL_CA`, off for local
  docker-compose and on in production. ([#31])
- **GitHub Actions keep mutable major tags.** With Dependabot disabled,
  SHA-pinning would freeze every action and cut off upstream security fixes with
  no bumper to restore them. (ADR-0010, [#33], closes [#7])
- **Lighthouse CI no longer gates the SEO category**, which conflicts with the
  console's deliberate `noindex`. Performance and best-practices budgets are
  unchanged. (ADR-0009, [#32])
- **SEO/AIEO tooling ruled not-applicable** — the widget is embedded in host
  pages and the console is a private authenticated SPA, so neither has a
  crawlable surface. (ADR-0009, closes [#1])

### Removed

- **axe-core**, via removal of `eslint-plugin-jsx-a11y` — its only transitive
  source — per project policy. Accessibility checking uses
  `@afixt/a11y-assert`. ([#26], [#27], closes [#25])
- **The OWASP Dependency-Check job.** It was the only `@main` branch reference,
  is effectively unmaintained (last release 2021), and added little over
  `npm audit`, `osv-scanner`, and CodeQL for an npm/TypeScript repository.
  (ADR-0010, [#33])

### Security

- Verified-secret scanning at pre-commit, pre-push, and in CI (trufflehog).
- TLS available on the database connection in production.
- `min-release-age=7` in `.npmrc` — a supply-chain cooldown before adopting
  brand-new releases. Enforced by npm >= 11.10; inert under the npm 10 that
  ships with Node 22, and effective on toolchain upgrade.
- `body-parser` bumped to 2.3.0, clearing OSV `GHSA-v422-hmwv-36x6`.

[Unreleased]: https://github.com/AFixt/livechat/compare/v0.1.2...HEAD
[0.1.2]: https://github.com/AFixt/livechat/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/AFixt/livechat/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/AFixt/livechat/releases/tag/v0.1.0
[#1]: https://github.com/AFixt/livechat/issues/1
[#3]: https://github.com/AFixt/livechat/issues/3
[#7]: https://github.com/AFixt/livechat/issues/7
[#19]: https://github.com/AFixt/livechat/issues/19
[#21]: https://github.com/AFixt/livechat/issues/21
[#25]: https://github.com/AFixt/livechat/issues/25
[#26]: https://github.com/AFixt/livechat/pull/26
[#27]: https://github.com/AFixt/livechat/pull/27
[#28]: https://github.com/AFixt/livechat/pull/28
[#29]: https://github.com/AFixt/livechat/pull/29
[#30]: https://github.com/AFixt/livechat/pull/30
[#31]: https://github.com/AFixt/livechat/pull/31
[#32]: https://github.com/AFixt/livechat/pull/32
[#33]: https://github.com/AFixt/livechat/pull/33
[#35]: https://github.com/AFixt/livechat/pull/35
[#36]: https://github.com/AFixt/livechat/pull/36
[#37]: https://github.com/AFixt/livechat/pull/37
[#38]: https://github.com/AFixt/livechat/pull/38
[#39]: https://github.com/AFixt/livechat/pull/39
[#40]: https://github.com/AFixt/livechat/pull/40
