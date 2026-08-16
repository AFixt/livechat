import { describe, expect, it, vi } from 'vitest';

import {
  CONSENT_EVENT,
  createConsentStore,
  installConsentApi,
  type AfixtLiveChatGlobal,
} from './consent.js';

describe('consent store', () => {
  it('defaults to functional granted, analytics denied', () => {
    const store = createConsentStore();
    expect(store.getConsent()).toEqual({ functional: true, analytics: false });
  });

  it('setConsent merges the decision and returns a snapshot', () => {
    const store = createConsentStore();
    const next = store.setConsent({ analytics: true });
    expect(next).toEqual({ functional: true, analytics: true });
    expect(store.getConsent().analytics).toBe(true);
    // Snapshot is a copy — mutating it must not affect the store.
    next.analytics = false;
    expect(store.getConsent().analytics).toBe(true);
  });

  it('notifies subscribers on change and stops after unsubscribe', () => {
    const store = createConsentStore();
    const listener = vi.fn();
    const off = store.onConsentChange(listener);
    store.setConsent({ analytics: true });
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenLastCalledWith({ functional: true, analytics: true });
    off();
    store.setConsent({ analytics: false });
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('emits a DOM CustomEvent on the event target', () => {
    const target = new EventTarget();
    const store = createConsentStore({ eventTarget: target });
    const handler = vi.fn();
    target.addEventListener(CONSENT_EVENT, handler);
    store.setConsent({ analytics: true });
    expect(handler).toHaveBeenCalledTimes(1);
    const event = handler.mock.calls[0]?.[0] as CustomEvent<{ analytics: boolean }>;
    expect(event.detail).toEqual({ functional: true, analytics: true });
  });

  it('allows capture immediately when consent is not required', async () => {
    const store = createConsentStore({ eventTarget: new EventTarget() });
    expect(store.isCaptureAllowed()).toBe(true);
    await expect(store.whenCaptureAllowed()).resolves.toBeUndefined();
  });

  it('gates a capturable action until analytics consent is granted', async () => {
    const store = createConsentStore({ eventTarget: new EventTarget() });
    store.requireConsent(true);
    expect(store.isCaptureAllowed()).toBe(false);

    let captured = false;
    const gate = store.whenCaptureAllowed();
    void gate.then(() => (captured = true));

    // The gate must not resolve while consent is pending.
    await Promise.resolve();
    expect(captured).toBe(false);

    store.setConsent({ analytics: true });
    await gate;
    expect(store.isCaptureAllowed()).toBe(true);
    expect(captured).toBe(true);
  });

  it('keeps capture blocked when only functional consent is granted', () => {
    const store = createConsentStore({ eventTarget: new EventTarget() });
    store.requireConsent(true);
    store.setConsent({ functional: true });
    expect(store.isCaptureAllowed()).toBe(false);
  });

  it('installConsentApi exposes the API on window.AfixtLiveChat', () => {
    const store = createConsentStore({ eventTarget: new EventTarget() });
    installConsentApi(store);
    const holder = globalThis as typeof globalThis & { AfixtLiveChat?: AfixtLiveChatGlobal };
    expect(holder.AfixtLiveChat).toBeDefined();
    holder.AfixtLiveChat?.setConsent({ analytics: true });
    expect(store.getConsent().analytics).toBe(true);
    expect(holder.AfixtLiveChat?.getConsent().analytics).toBe(true);
  });
});
