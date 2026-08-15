# ADR-0011: Per-tenant CORS with default-deny for the embeddable widget

- **Status:** Accepted
- **Date:** 2026-08-14
- **Deciders:** Karl Groves

## Context

The widget is embedded on arbitrary customer sites and calls the API with
credentials (`credentials: 'include'`) from those origins. The API previously
reflected a single fixed CORS origin — the support console (`APP_URL`) — so
every cross-origin widget request was blocked by the browser (#74). The product
premise ("embeddable on arbitrary client websites") did not work off the
console's own origin.

The infrastructure to authorize origins already existed but was not wired to the
CORS response: a per-tenant `tenants.allowed_origins` column, and an
`originAllowed()` middleware that 403s a request whose `Origin` is not in the
resolved tenant's list. The open question this ADR settles is the **default**
for a tenant that has configured **no** origins. `originAllowed()` historically
treated empty/null `allowed_origins` as "no restriction", and
`seed-first-tenant` creates tenants with `allowed_origins: null`. "Unrestricted"
is a poor default for a credentialed, cross-origin endpoint.

## Decision

1. **Reflect, per origin, only for widget-facing routes.** For
   `/api/v1/visitor/*` and `/api/v1/widget/*` (and their `/v1` aliases), the
   CORS layer reflects the requesting `Origin` **only when it appears in some
   active tenant's `allowed_origins`**, and rejects it otherwise. Console routes
   keep the strict fixed `APP_URL` policy. The Socket.IO handshake CORS is
   resolved the same way. `Vary: Origin` is set on every origin-dependent
   response (the `cors` package does this for any non-`*` origin).

2. **Default-deny cross-site.** An origin that no tenant has authorized is never
   reflected, so a tenant with no configured `allowed_origins` **cannot be
   embedded cross-site**. Configuring at least one allowed origin is a required
   provisioning step, surfaced in the admin "Allowed origins" field.

3. **Defence in depth stays.** `originAllowed()` remains the per-request check
   that the origin belongs to _this_ tenant. The CORS layer answers "is this a
   known widget origin at all"; `originAllowed()` answers "does it match the
   tenant being addressed". Both must pass.

## Consequences

- The widget works on any origin a tenant lists, and only those.
- New tenants are not embeddable until an admin adds an origin — intended, and
  documented next to the admin field and in `docs/deploy.md`'s first-tenant
  steps.
- The origin→allowed decision is cached in-process for 60s to keep the widget's
  hot path off a per-request tenants scan; allowed-origins edits take effect
  within that window (or immediately in a single process via
  `clearOriginCache()`).
- A JSON `allowed_origins` column is scanned with `JSON_CONTAINS`; at current
  tenant counts this is cheap, and the cache bounds it. If tenant counts grow
  large, promote the origin set to Redis.

## Alternatives considered

- **Reflect any origin for a tenant with empty `allowed_origins`** (the prior
  implicit behaviour) — rejected: it hands a credentialed cross-origin endpoint
  to any site by default, exactly the anti-pattern the issue calls out.
- **Wildcard `Access-Control-Allow-Origin: *`** — impossible with
  `credentials: true`, and would defeat tenant isolation.
- **Resolve the tenant from `tenantKey` in the CORS layer** — rejected: the CORS
  preflight (`OPTIONS`) carries no body/query, only the `Origin` header, so the
  decision must be origin-based. Per-tenant matching is left to
  `originAllowed()` on the actual request.

## Links

- requirements.md §3, §6.2 (embed contract)
- GitHub #74 (this change), #75 (SameSite cookie — must also land for the widget
  to work cross-site)
- [ADR-0003](0003-widget-framework-preact.md)
