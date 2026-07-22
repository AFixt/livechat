# ADR-0009: SEO/AIEO tooling is out of scope for this product's surfaces

- **Status:** Accepted
- **Date:** 2026-07-21
- **Deciders:** Karl Groves

## Context

Issue #1's tooling stack lists an SEO/AIEO section: `react-helmet-async` for
per-page meta, JSON-LD via `schema-dts`, a build-time sitemap + `robots.txt`, an
`llms.txt` for AI crawlers, the Lighthouse SEO category, and SSR/SSG for
content-heavy surfaces. Those items assume a public, crawlable web surface.

This product has none:

- **Customer widget (`widget/`)** is injected into arbitrary client sites via a
  JS snippet and rendered inside a Shadow DOM. It has no standalone page or URL
  of its own to index; its host page owns all SEO.
- **Support/admin console (`ui/`)** is a single-page app that lives entirely
  behind authentication. There is no anonymous content to rank, and it should
  never appear in a search index.
- The **API (`api/`)** serves JSON, not documents.

## Decision

Do **not** adopt the SEO/AIEO tooling from issue #1 (`react-helmet-async`,
`schema-dts` JSON-LD, sitemap/`robots.txt` generation, `llms.txt`, the
Lighthouse SEO category as a content gate, SSR/SSG). None of it has a surface to
act on here.

The one concrete measure that does apply — making sure the private console is
never indexed if it is ever exposed — is handled directly: `ui/index.html`
carries `<meta name="robots" content="noindex, nofollow">`.

Lighthouse CI is still run (`.lighthouserc.json` / `lhci.yml`) for
**performance** and **best-practices** budgets, but the **SEO category is
removed** from `onlyCategories` and its assertion dropped: the console's
deliberate `noindex` fails Lighthouse's `is-crawlable` SEO audit, which is the
correct outcome for a private app, not a regression to gate on. (a11y is covered
separately by `@afixt/a11y-assert`.)

## Consequences

- No `llms.txt`, `sitemap.xml`, `robots.txt`, JSON-LD, or head-management
  library is added. The corresponding acceptance items in issue #1 are closed as
  not-applicable rather than done.
- If a public, crawlable surface is ever introduced (a marketing site, public
  docs, a status page), revisit this ADR — the tooling in issue #1 becomes
  relevant again for that surface only.
