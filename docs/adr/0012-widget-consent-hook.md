# ADR-0012: Widget consent hook for host-site CMPs

- **Status:** Accepted
- **Date:** 2026-08-15
- **Deciders:** Engineering, AFixt (data controller)

## Context

The widget embeds on arbitrary third-party sites and, on boot, captures visitor
presence data (current URL, referrer, language, truncated IP) and opens a
presence socket. Those host sites are frequently subject to consent regimes
(GDPR/ePrivacy, CCPA) and run their own Consent Management Platform. Until now
the widget offered no way for a host CMP to gate that capture — it began
immediately on load, with no public contract for grant/deny. Issue #54.

A companion effort (#56 consent model, #53 consent gate, #55 GPC) builds the
server-side consent foundation. The widget needs a **stable, additive** public
hook that foundation can consume, and that works standalone until it lands. The
widget also has a hard bundle-size budget (`size-limit`, 50 KB brotli), so the
hook must be dependency-free and tiny.

## Decision

Add a small consent module (`widget/src/services/consent.ts`) and expose a
public contract on the host page:

1. **Opt-in attribute** — `data-require-consent` on the `<afixt-livechat>`
   element turns on gating. Absent it, behavior is unchanged (capture proceeds),
   so existing embeds are unaffected.
2. **Global API** — `window.AfixtLiveChat` with:
   - `setConsent({ functional?, analytics? })` — merge a decision;
   - `getConsent()` — read the current decision;
   - `onConsentChange(listener)` — subscribe, returns an unsubscribe fn.
3. **DOM event** — every change dispatches
   `CustomEvent('afixt-livechat:consent', { detail: { functional, analytics } })`.
4. **Two categories** — `functional` (chat operation + strictly-necessary
   session cookie; granted by default) and `analytics` (presence/telemetry
   capture; denied by default).
5. **Capture gate** — the widget bootstrap awaits `whenCaptureAllowed()` before
   any session init or socket connection. It resolves immediately when consent
   isn't required, and once `analytics` is granted otherwise. This is the single
   additive integration point the #56/#53 foundation reads.

The store is a dependency-free singleton with an injectable event target for
testing. It adds well under 1 KB to the bundle (measured total 20.7 KB brotli,
budget 50 KB).

## Consequences

- Host CMPs can defer all presence/analytics capture with one attribute plus a
  `setConsent` call. Note that because the visitor-session init is itself the
  telemetry-carrying call and the chat depends on that session, enabling the
  gate holds the **entire** widget bootstrap (session init + socket) until
  `analytics` is granted — so while gating is on and consent is withheld, chat
  cannot start either. The `functional` category is stored and emitted for host
  CMPs and the #56/#53 foundation but does not by itself release the gate; a
  clean split that keeps strictly-necessary chat available without analytics
  consent requires that server-side foundation.
- The public surface (attribute, global API, event, categories) is a committed
  contract — the consent foundation and any host integration depend on it, so
  changes must stay backward-compatible.
- The gate defers rather than drops capture, so a late grant still works; a
  never-granted gate means the visitor never appears in presence and cannot
  start a chat — an intended privacy outcome, but one that must be documented
  for support staff.
- Client-side consent alone is advisory; the server still verifies identity
  tokens and applies data minimization/retention (ADR-0011). This hook governs
  _whether_ capture starts, not _what_ is stored once it does.

## Alternatives considered

- **No gate; document the cookies only** — rejected: some host sites must be
  able to withhold non-essential capture to meet their own obligations.
- **Block on a cookie/localStorage flag the host sets** — rejected: couples the
  contract to storage the CMP may itself gate, and gives no event/callback for
  dynamic consent changes.
- **Bundle a CMP/TCF library** — rejected: violates the size budget and the
  "no third-party SDKs" rule; host CMPs differ, so a thin mapping surface is
  more portable than adopting one vendor's model.

## Links

- requirements.md §3 (widget embedding / visitor identity)
- `docs/privacy/cookie-inventory.md`, `docs/privacy/cmp-integration.md`
- `widget/src/services/consent.ts`, `widget/src/widget-element.tsx`
- ADR-0011 (retention & minimization — the storage-side counterpart)
- GitHub issue #54; consent foundation #56 / #53 / #55
