# Changelog

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Architecture decisions referenced below live in [`docs/adr/`](docs/adr/).

## [Unreleased]

_Nothing yet._

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

[Unreleased]: https://github.com/AFixt/livechat/compare/v0.1.0...HEAD
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
