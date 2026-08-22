# ADR-0021: Visitor session survives third-party-cookie blocking via a header fallback

- **Status:** Accepted
- **Date:** 2026-08-21
- **Deciders:** Karl Groves

## History

This decision was originally made and reviewed in PR #93 (2026-08-14), which
merged into `fix/77-csrf` twelve minutes _after_ that branch had already merged
to `develop` — so the branch was abandoned and none of the work reached
`develop`. The cookie stayed `SameSite=Lax` and the fallback never existed. The
decision is unchanged; this ADR restates it at its recovered number, and the
implementation is re-applied on top of the intervening consent work (ADR-0019),
which had since moved the cookie options into a shared helper of its own.

## Context

The visitor session cookie was `SameSite=Lax`, so browsers never sent it on the
cross-site subresource requests an embedded widget makes — the visitor was
unauthenticated on every call after the first, and the Socket.IO handshake had
no cookie (#75). The obvious fix — `SameSite=None; Secure` — is necessary but
**not sufficient**: Safari (ITP) and Firefox (Total Cookie Protection) block
third-party cookies outright, and Chrome partitions or blocks them for a growing
share of users. A `SameSite=None` cookie alone would leave the widget
non-functional for a large fraction of real visitors.

The widget script runs in the host page's **first-party** context (it is not a
cross-origin iframe), so it has first-party `localStorage` and can attach custom
request headers — the API is same-origin to `fetch` only in dev, but the widget
can always send headers cross-origin once CORS allows them (#74).

## Decision

1. **Cookie:** issue `SameSite=None; Secure; Partitioned` (CHIPS) in production;
   keep `SameSite=Lax` in local dev over plain HTTP so a `None` cookie is never
   emitted without `Secure`. This covers browsers that still allow the
   (partitioned) third-party cookie.

2. **Primary, browser-agnostic path — a session token in a header.** The
   bootstrap endpoints (`/visitor/session`, `/visitor/chats/current`) return the
   signed session value as `sessionToken`. The widget persists it in first-party
   `localStorage` and resends it as `X-Visitor-Session` on every request; the
   Socket.IO handshake passes it as `auth.cookie` (already supported). The API
   resolves the session from that header first, then the cookie
   (`readVisitorSessionValue`). This works identically on Safari, Firefox, and
   Chrome regardless of third-party-cookie policy.

3. The header is a custom header, so it triggers a CORS preflight the per-tenant
   CORS layer (#74) already gates, and it is never attached automatically by the
   browser — so it does not reintroduce the CSRF exposure #77 closes.

## Consequences

- The widget works cross-site on all current browsers, not only those that allow
  third-party cookies.
- The session value lives in host-page `localStorage`. It is the visitor's own
  session credential (first-party to the site they are on), not a tracker; no
  cross-site identifier is shared. Storage-blocked contexts fall back to the
  in-memory copy for the page's lifetime.
- Two code paths resolve the session (header, cookie); both go through one
  helper (`middlewares/visitor-request.ts`) so they cannot diverge. The privacy
  router (ADR-0019) resolves its subject through the same helper, so a
  cookie-blocked visitor can still read, record and withdraw consent.
- `res.clearCookie` must repeat the same attributes, or a
  `SameSite=None; Secure; Partitioned` cookie is not cleared on "forget me"
  (#79).
- A full built-widget cross-origin end-to-end test (Safari-like, third-party
  cookies disabled) is the remaining verification and is tracked with the e2e
  work; the attribute and header-path behaviours are unit/integration tested
  here.

## Alternatives considered

- **`SameSite=None; Secure` cookie only** — rejected: silently fails for Safari
  and Firefox users, i.e. a large share of real visitors.
- **Cross-origin iframe with its own first-party cookie** — rejected: heavier,
  complicates the accessible-name/focus-through-shadow-DOM contract (ADR-0003),
  and still needs a storage-access story.
- **`Partitioned` (CHIPS) alone** — kept as progressive enhancement, but Safari
  does not implement CHIPS, so it cannot be the only mechanism.

## Links

- requirements.md §3, §6.2
- GitHub #75 (this change), #74 (CORS — landed), #77 (CSRF — landed)
- [ADR-0003](0003-widget-framework-preact.md),
  [ADR-0018](0018-widget-cors-default-deny.md),
  [ADR-0019](0019-consent-model-and-jurisdiction-policy.md)
