import { afterEach, describe, expect, it } from 'vitest';

/**
 * Environment guard for issue #153, pinning what `vitest.config.ts` arranges.
 *
 * Node 22.4+ ships its own Web Storage globals, and its `localStorage` is inert
 * unless the process was started with `--localstorage-file`. Vitest's jsdom
 * environment leaves an already-present global alone, so that inert one used to
 * shadow jsdom's and `window.localStorage` came out `undefined` — every suite
 * touching storage failed with `Cannot read properties of undefined`, which
 * reads like a product bug rather than a runtime mismatch. The test worker now
 * starts with `--no-experimental-webstorage`, handing the name back to jsdom.
 *
 * These tests pin that arrangement: if the runtime, the flag, or vitest's
 * global-population order changes again, the failure names its own cause here
 * instead of surfacing as a pile of unrelated red tests.
 *
 * The ui and widget workspaces each carry a copy of this guard on purpose.
 * Each configures its own vitest worker, so each needs its own guard, and
 * hoisting the shared half into a cross-workspace module would put a `../../`
 * import inside `src/**` — which is how the ui image build broke in #130, when
 * `ui/tsconfig.json` pulled in a repo-root file the Dockerfile never copied.
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
    // `toBeInstanceOf(Storage)` is what tells jsdom's implementation apart from
    // Node's: with the flag missing, this arrives as Node's own Storage and
    // fails against jsdom's constructor.
    expect(window.sessionStorage).toBeInstanceOf(Storage);

    window.sessionStorage.setItem('livechat.probe', 'session-value');
    expect(window.sessionStorage.getItem('livechat.probe')).toBe('session-value');
    // The widget keeps its visitor session token in localStorage only; a
    // single shared store would hide a leak into sessionStorage.
    expect(window.localStorage.getItem('livechat.probe')).toBeNull();
  });

  it('reaches the same store through the bare `localStorage` binding', () => {
    // The widget's own code goes through `window.localStorage`, but the two
    // access paths must still name one store: services/api.test.ts stubs the
    // window path and expects the code under test to see that stub.
    window.localStorage.setItem('livechat.probe', 'via-window');

    expect(localStorage).toBeInstanceOf(Storage);
    expect(localStorage.getItem('livechat.probe')).toBe('via-window');
  });
});
