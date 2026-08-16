import { render } from 'preact';

import { App } from './app.js';
import { consentStore, installConsentApi } from './services/consent.js';
import widgetStyles from './styles.css?inline';

const TAG = 'afixt-livechat';

/**
 * Custom element that hosts the widget inside an open shadow root. A single
 * instance per host page is expected; multiple instances would clobber the
 * visitor cookie.
 */
export class AfixtLivechatElement extends HTMLElement {
  #root: ShadowRoot | null = null;

  /**
   * Attach the open shadow root, inject styles, and mount the Preact app
   * on first connection. No-op on subsequent reconnects.
   */
  public connectedCallback(): void {
    if (this.#root !== null) return;
    this.#root = this.attachShadow({ mode: 'open' });

    const style = document.createElement('style');
    style.textContent = widgetStyles;
    this.#root.append(style);

    const slot = document.createElement('div');
    this.#root.append(slot);

    // CMP hook: expose `window.AfixtLiveChat.setConsent(...)` for the host
    // page, and — when `data-require-consent` is present (and not "false") —
    // hold all analytics/presence capture until consent is granted. Absent the
    // attribute the widget behaves as before (capture allowed immediately).
    installConsentApi(consentStore);
    const requireConsentAttr = this.getAttribute('data-require-consent');
    consentStore.requireConsent(requireConsentAttr !== null && requireConsentAttr !== 'false');

    const tenantKey = this.getAttribute('data-tenant-key') ?? '';
    render(<App tenantKey={tenantKey} />, slot);
  }

  /**
   * Unmount the Preact tree when the element is removed from the DOM.
   */
  public disconnectedCallback(): void {
    if (this.#root !== null) {
      render(null, this.#root);
    }
  }
}

/**
 * Register the custom element once. Safe to call multiple times — the
 * second call is a no-op.
 */
export function registerWidgetElement(): void {
  if (customElements.get(TAG) === undefined) {
    customElements.define(TAG, AfixtLivechatElement);
  }
}
