# CMP / consent integration for host sites

How a client site's Consent Management Platform (CMP) grants or denies consent
before the AFixt LiveChat widget captures any analytics/presence data. Tracked
in issue #54; the contract is specified in
[ADR-0012](../adr/0012-widget-consent-hook.md).

## What consent gates

The widget recognizes two consent categories:

| Category | Covers | Default |
| --- | --- | --- |
| `functional` | The chat itself — message transport and the strictly-necessary `livechat_visitor` session cookie. | Granted |
| `analytics` | Visitor **presence/telemetry capture**: the session-init call that records current URL, referrer, language and (truncated) IP, and live presence in the support console. | Denied |

When gating is enabled, the widget **holds all presence/analytics capture**
(the visitor-session init and the socket connection) until the host grants
`analytics`. Functional chat operation is always permitted.

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
retention/minimization policy — see
[`data-retention.md`](./data-retention.md).)

## Relationship to the consent foundation (#56/#53/#55)

This hook is the **integration point** the broader AFixt consent foundation
consumes. Until that foundation ships, the hook stores the host's decision and
exposes it via the API and event above, and enforces the capture gate in the
widget bootstrap. When #56/#53 land, the server-side consent model and gate read
from this same contract — the public API (`data-require-consent`,
`window.AfixtLiveChat.setConsent/getConsent/onConsentChange`, the
`afixt-livechat:consent` event) is stable and additive.
