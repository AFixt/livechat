# CMP / consent integration for host sites

How a client site's Consent Management Platform (CMP) grants or denies consent
before the AFixt LiveChat widget captures any analytics/presence data. Tracked
in issue #54; the contract is specified in
[ADR-0014](../adr/0014-widget-consent-hook.md).

## What consent gates

The widget recognizes two consent categories:

| Category | Covers | Default |
| --- | --- | --- |
| `functional` | The chat itself — message transport and the strictly-necessary `livechat_visitor` session cookie. | Granted |
| `analytics` | Visitor **presence/telemetry capture**: the session-init call that records current URL, referrer, language and (truncated) IP, and live presence in the support console. | Denied |

When gating is enabled, the widget **holds its entire capture bootstrap** — the
visitor-session init call (which sets the `livechat_visitor` cookie) and the
presence socket — until the host grants `analytics`. The session-init call is
itself what records the presence/telemetry data, and the chat depends on that
session, so **while gating is on and `analytics` is denied no chat can start**:
capture is deferred, not dropped, so a later `setConsent({ analytics: true })`
releases the gate and the chat proceeds normally.

The `functional` category is recorded and emitted for host CMPs (and is the
integration point the forthcoming #56/#53 server-side consent model consumes),
but on its own it does **not** release the gate today — the gate keys on
`analytics`. A clean split that keeps strictly-necessary chat available without
analytics consent requires the server-side foundation (#56/#53); until it lands,
only enable `data-require-consent` if holding the whole widget until consent is
the intended behavior.

## Enabling the gate

Add `data-require-consent` to the embed element. Without this attribute the
widget behaves as before (capture proceeds immediately) — the gate is opt-in.

```html
<!-- Gated: nothing is captured until the CMP calls setConsent(). -->
<afixt-livechat data-tenant-key="your-tenant-slug" data-require-consent></afixt-livechat>
```

## Granting / denying consent

The widget exposes a small global API, `window.AfixtLiveChat`, plus a DOM event.
Wire your CMP's allow/deny callbacks to it.

```html
<script>
  // Called by your CMP when the visitor accepts/rejects the relevant category.
  function onCmpDecision(consent) {
    // consent.statistics / consent.marketing etc. → map to AFixt categories.
    window.AfixtLiveChat.setConsent({
      functional: true, // chat operation
      analytics: consent.statistics === true, // presence/telemetry capture
    });
  }

  // Read the current decision at any time:
  // window.AfixtLiveChat.getConsent(); // → { functional, analytics }

  // Or subscribe to changes:
  // const off = window.AfixtLiveChat.onConsentChange((state) => { ... });
</script>
```

`setConsent` accepts a partial decision and merges it, so you can grant
categories independently and call it again when the visitor changes their mind.

### Timing

`window.AfixtLiveChat` is installed as soon as the `<afixt-livechat>` element
connects. If your CMP may resolve **before** the widget script loads, call
`setConsent` from the widget's `afixt-livechat:consent` readiness or simply
re-call it after the script tag; a late grant still releases the capture gate.
Because the gate defers capture rather than dropping it, calling `setConsent`
after the page settles is safe.

## Listening for consent changes (DOM event)

Every `setConsent` also dispatches a `CustomEvent`:

```js
window.addEventListener('afixt-livechat:consent', (e) => {
  // e.detail === { functional: boolean, analytics: boolean }
  console.log('AFixt LiveChat consent is now', e.detail);
});
```

## Denying after a grant

Calling `setConsent({ analytics: false })` records the withdrawal and blocks
future capture. (Data already captured under a prior grant is governed by the
visitor data-retention / minimization policy — ADR-0011, landing with
issue #57.)

## Relationship to the consent foundation (#56/#53/#55)

This hook is the **integration point** the broader AFixt consent foundation
consumes. Until that foundation ships, the hook stores the host's decision and
exposes it via the API and event above, and enforces the capture gate in the
widget bootstrap. When #56/#53 land, the server-side consent model and gate read
from this same contract — the public API (`data-require-consent`,
`window.AfixtLiveChat.setConsent/getConsent/onConsentChange`, the
`afixt-livechat:consent` event) is stable and additive.
