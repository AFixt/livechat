# ADR-0012: Security headers for the static-hosted console and widget

- **Status:** Accepted
- **Date:** 2026-08-15
- **Deciders:** Karl Groves

## Context

The support console (`ui/`) and the customer widget (`widget/`) ship as static
builds served by nginx (`ui/nginx.conf`, `widget/nginx.conf`) on DigitalOcean
App Platform. Both set a partial header set — `X-Content-Type-Options`,
`Referrer-Policy`, and (for the widget) CORS/`Cross-Origin-Resource-Policy` —
but neither declared a Content-Security-Policy, `Cross-Origin-Opener-Policy`, or
`Strict-Transport-Security`, and the console had no clickjacking defence. The
API sets its own headers via `helmet`; these two static hosts were the gap.
Issue #61 (first tranche of the #59-65 / #82-84 security-baseline program)
closes it and adds an automated check so the header sets cannot silently drift.

The two hosts have opposite embedding requirements. The console is a first-party
app that must **never** be framed. The widget is an embed contract
(requirements.md §6.2): client sites load `widget.js` cross-origin, so it must
stay embeddable and cross-origin-readable. A single policy cannot serve both.

## Decision

Add the following to **both** static hosts, repeated in every `location` block
that sets any `add_header` (nginx does not merge inherited `add_header`
directives — a location that sets one inherits none):

- **Content-Security-Policy** — `default-src 'self'`; `script-src 'self'` (no
  inline, **no `'unsafe-eval'`**); `img-src 'self' data:`; `font-src 'self'`;
  `object-src 'none'`; `base-uri 'self'`; `form-action 'self'`; and
  `connect-src 'self' https://api.livechat.afixt.com wss://api.livechat.afixt.com`
  for REST + Socket.IO (WSS).
  - `style-src 'self' 'unsafe-inline'` on **both**. This is a deliberate, scoped
    concession: MUI/emotion inject `<style>` tags and inline `style=` attributes
    at runtime in the console, and the widget injects its own styles into its
    shadow root — neither can carry a per-response nonce from a static nginx
    host. `'unsafe-inline'` is confined to `style-src`; scripts stay strict,
    which is where it matters for XSS.
- **Cross-Origin-Opener-Policy:** `same-origin` on both (process isolation for
  the hosts' own top-level documents; harmless for the embedded widget, whose
  COOP is ignored inside a cross-origin frame).
- **Strict-Transport-Security:** `max-age=63072000; includeSubDomains; preload`
  (two years, subdomains, preload-eligible) on both.
- Keep/confirm `X-Content-Type-Options: nosniff` and
  `Referrer-Policy: strict-origin-when-cross-origin`.

Diverge where the hosts diverge:

| Header                         | Console (`ui/`)                                        | Widget (`widget/`)                                               |
| ------------------------------ | ------------------------------------------------------ | ---------------------------------------------------------------- |
| `Cross-Origin-Resource-Policy` | `same-origin` — no other site loads console assets     | `cross-origin` — client sites must load `widget.js`              |
| Framing                        | `X-Frame-Options: DENY` + CSP `frame-ancestors 'none'` | no `X-Frame-Options`; CSP `frame-ancestors *` — stays embeddable |
| `Access-Control-Allow-Origin`  | not set                                                | `*` (kept — the embed contract)                                  |

Add `scripts/check-headers.mjs`, wired as `npm run security:headers` and into
the aggregate `security` script (so it runs in `check:all`/CI). It is a **config
lint**, not a live probe: it parses both `nginx.conf` files and asserts every
required directive is present, with the expected value, in the server block and
in every header-emitting `location` block — and that the forbidden directives
(framing on the widget, cross-origin CORP on the console) are absent.

## Consequences

- The console gains real XSS containment and clickjacking defence; the widget
  gains the same CSP while staying embeddable. HSTS forces HTTPS on both
  subdomains and makes them preload-eligible.
- The `connect-src` origin is **hardcoded** to `api.livechat.afixt.com`. Because
  the nginx config is baked into the static image at build time, changing the
  API domain (or adding a staging domain) requires editing both configs.
  `security:headers` does not verify the origin is reachable — only that the
  directive is present — so a wrong origin still passes the lint but breaks the
  app at runtime. This is the accepted cost of a static host without templating.
- `style-src 'unsafe-inline'` remains until MUI/emotion and the widget move to
  nonces or hashed styles; documented here so it is a known, revisitable
  concession rather than a silent hole.
- The header lists are duplicated across each `location` block by necessity.
  `security:headers` is the guard against the two copies drifting.
- Booting nginx in CI to probe live responses was rejected as impractical (needs
  a full Docker build first); the config lint is the pragmatic stand-in.

## Alternatives considered

- **Live probe (boot nginx + curl each header)** — highest fidelity, but needs
  the built assets and a running container in CI; too heavy for a gate. The
  config lint catches the realistic failure mode (a dropped/renamed directive).
- **`script-src 'unsafe-inline'` / `'unsafe-eval'`** — rejected outright; it
  would defeat the CSP's main purpose. Only `style-src` is relaxed.
- **Templating `connect-src` from an env var at container start** — deferred; it
  adds an entrypoint script to both images for a value that changes rarely.
  Revisit if a staging API origin is added.
- **Setting these headers at the API/helmet layer** — does not apply; the static
  assets are served by nginx, never routed through Express.

## Links

- requirements.md §6.2 (widget embed contract)
- GitHub issue #61; security-baseline program #59-65, #82-84
- `ui/nginx.conf`, `widget/nginx.conf`, `scripts/check-headers.mjs`
- ADR-0005 (observability / ZAP), ADR-0010 (Actions tags)
