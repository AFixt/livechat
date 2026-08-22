import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type * as ApiModule from './api.js';

/**
 * Install an in-memory `window.localStorage`. This jsdom environment provides
 * none, which is also a real browser condition (storage blocked in private
 * mode), so the module must tolerate both — see the last test.
 * @returns A restore function.
 */
function installStorage(): () => void {
  const store = new Map<string, string>();
  const stub = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => {
      store.set(k, v);
    },
    removeItem: (k: string) => {
      store.delete(k);
    },
    clear: () => {
      store.clear();
    },
  };
  const original = Object.getOwnPropertyDescriptor(window, 'localStorage');
  Object.defineProperty(window, 'localStorage', { configurable: true, value: stub });
  return () => {
    if (original === undefined)
      delete (window as unknown as { localStorage?: unknown }).localStorage;
    else Object.defineProperty(window, 'localStorage', original);
  };
}

/**
 * Load a fresh copy of the api module. Its session-token state is module-level
 * (hydrated from storage at import time), so each test needs its own instance.
 * @returns The freshly imported module.
 */
async function freshApi(): Promise<typeof ApiModule> {
  vi.resetModules();
  return import('./api.js');
}

/**
 * Stub `fetch` with a single JSON envelope response.
 * @param data - The `data` payload to return.
 * @returns The mock, for asserting on the request it received.
 */
function stubFetch(data: unknown): ReturnType<typeof vi.fn> {
  const mock = vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: () => Promise.resolve({ success: true, data }),
  });
  vi.stubGlobal('fetch', mock);
  return mock;
}

/**
 * Read the headers of the first stubbed fetch call.
 * @param mock - The fetch mock.
 * @returns The Headers the widget sent.
 */
function sentHeaders(mock: ReturnType<typeof vi.fn>): Headers {
  return (mock.mock.calls[0]?.[1] as RequestInit).headers as Headers;
}

describe('visitor session token — third-party-cookie fallback (#75)', () => {
  const cleanups: (() => void)[] = [];

  beforeEach(() => {
    cleanups.push(installStorage());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    while (cleanups.length > 0) cleanups.pop()?.();
  });

  it('does not send X-Visitor-Session before a session exists', async () => {
    const api = await freshApi();
    const mock = stubFetch({});
    await api.apiFetch('/widget/config');
    expect(sentHeaders(mock).has('X-Visitor-Session')).toBe(false);
  });

  it('sends the token on every request once a session is recorded', async () => {
    const api = await freshApi();
    api.setSessionToken('signed.session.value');
    const mock = stubFetch({});
    await api.apiFetch('/visitor/chats/current');
    expect(sentHeaders(mock).get('X-Visitor-Session')).toBe('signed.session.value');
  });

  it('persists the token so a later page load still authenticates', async () => {
    const first = await freshApi();
    first.setSessionToken('persisted.value');

    // A fresh module instance stands in for the next page load.
    const reloaded = await freshApi();
    expect(reloaded.getSessionToken()).toBe('persisted.value');
  });

  it('initVisitorSession records the token the API hands back', async () => {
    const api = await freshApi();
    stubFetch({
      sessionId: 's1',
      tenantId: 't1',
      csrfToken: 'csrf',
      sessionToken: 'from.bootstrap',
    });
    await api.initVisitorSession('acme');
    expect(api.getSessionToken()).toBe('from.bootstrap');
  });

  it('fetchCurrentChat records the echoed token for a returning visitor', async () => {
    const api = await freshApi();
    stubFetch({ chat: null, messages: [], csrfToken: 'csrf', sessionToken: 'echoed.value' });
    await api.fetchCurrentChat();
    expect(api.getSessionToken()).toBe('echoed.value');
  });

  it('still works for the page load when storage is unavailable', async () => {
    // Drop storage entirely — private mode, blocked storage, or a host page
    // that has partitioned it away. The widget must degrade to memory, not throw.
    cleanups.pop()?.();
    const api = await freshApi();
    expect(() => {
      api.setSessionToken('memory.only');
    }).not.toThrow();
    expect(api.getSessionToken()).toBe('memory.only');

    const mock = stubFetch({});
    await api.apiFetch('/visitor/chats/current');
    expect(sentHeaders(mock).get('X-Visitor-Session')).toBe('memory.only');
  });
});
