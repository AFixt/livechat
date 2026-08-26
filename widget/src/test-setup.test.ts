import { afterEach, describe, expect, it } from 'vitest';

/**
 * Environment guard for issue #153.
 *
 * Node 22.4+ ships its own Web Storage globals, and its `localStorage` is inert
 * unless the process was started with `--localstorage-file`. Vitest's jsdom
 * environment leaves an already-present global alone, so that inert one used to
 * shadow jsdom's and `window.localStorage` came out `undefined` — every suite
 * touching storage failed with `Cannot read properties of undefined`, which
 * reads like a product bug rather than a runtime mismatch. `vitest.config.ts`
 * now starts the worker with `--no-experimental-webstorage`.
 *
 * These tests pin that arrangement: if the runtime, the flag, or vitest's
 * global-population order changes again, the failure names its own cause here
 * instead of surfacing as a pile of unrelated red tests.
 */
describe('test environment — Web Storage (issue #153)', () => {
  afterEach(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
  });

  it('exposes a usable window.localStorage', () => {
    expect(window.localStorage).toBeInstanceOf(Storage);

    window.localStorage.setItem('livechat.probe', 'value');
    expect(window.localStorage.getItem('livechat.probe')).toBe('value');
    expect(window.localStorage.length).toBe(1);

    window.localStorage.removeItem('livechat.probe');
    expect(window.localStorage.getItem('livechat.probe')).toBeNull();
  });

  it('exposes a usable window.sessionStorage, kept separate from localStorage', () => {
    expect(window.sessionStorage).toBeInstanceOf(Storage);

    window.sessionStorage.setItem('livechat.probe', 'session-value');
    expect(window.sessionStorage.getItem('livechat.probe')).toBe('session-value');
    // The widget keeps its visitor session token in localStorage only; a
    // single shared store would hide a leak into sessionStorage.
    expect(window.localStorage.getItem('livechat.probe')).toBeNull();
  });

  it('resolves the global localStorage to the jsdom one, not the inert Node one', () => {
    // The inert global is an accessor that yields `undefined`; jsdom's is a
    // real object. Asserting on the global (not just `window`) keeps the check
    // honest even if the two stop being the same object.
    expect(globalThis.localStorage).toBe(window.localStorage);
    expect(globalThis.localStorage).toBeDefined();
  });
});
