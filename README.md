# livechat

Accessibility-first, multi-tenant live chat support widget embeddable on
arbitrary client websites via a JS snippet.

This repo started life as a Tenon.io-era spec that was written but never built
(see the original post,
[Build vs. Buy is even harder when you care about accessibility](https://web.archive.org/web/20230606121614/https://blog.tenon.io/build-vs-buy-is-even-harder-when-you-care-about-accessibility/)).
It is now being built as an AFixt product.

## Status

Phase 0 (repo foundations) complete — tooling, CI, ADRs, workspace scaffolds.
Implementation work is sequenced by phase in `.claude/plans/` and tracked in
GitHub issues.

## Start here

- `CLAUDE.md` — orientation for Claude Code and new contributors
- `requirements.md` — product spec (RFC 2119 language)
- `docs/adr/` — architecture decisions
- `usecases/` — every user-facing interaction as `.uc.yaml`, per ADR-0002

## Setup

```sh
nvm use                 # Node 22, per .nvmrc
bash scripts/bootstrap.sh   # install local tool binaries (semgrep, osv-scanner, trufflehog, lychee)
npm ci                  # install workspace dependencies
docker compose up -d    # MySQL + Redis + MailHog + MinIO
npm run dev             # run api, ui, and widget in parallel
```

Then `npm run check:all` should pass on a clean clone — it is the same gate
Husky runs on pre-push.

## Scripts

From the repo root:

| Script              | Purpose                                                                                  |
| ------------------- | ---------------------------------------------------------------------------------------- |
| `npm run dev`       | Run api, ui, widget in parallel                                                          |
| `npm run check`     | lint + typecheck + stylelint + markdownlint + usecases:validate                          |
| `npm run check:all` | `check` + test + build + size + dupes + links + security + license:check (pre-push gate) |
| `npm test`          | Vitest across workspaces                                                                 |
| `npm run test:e2e`  | Generate Playwright specs from `usecases/` and run them                                  |
| `docker compose up` | MySQL + Redis + MailHog + MinIO + api + ui + widget-preview                              |

## Contributing

- Node 22 (pinned via `.nvmrc` and `engines`)
- Conventional Commits enforced via Husky `commit-msg`
- Run `scripts/bootstrap.sh` once to install local tool binaries (semgrep,
  osv-scanner, trufflehog, lychee) required by pre-push hooks
- All user-facing changes must include a corresponding `.uc.yaml` update
  (enforced by a CI diff gate)

## License

Proprietary. © AFixt. This is a private product (`"private": true`); it is not
licensed for external use or redistribution.
