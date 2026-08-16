import { afterEach, describe, expect, it, vi } from 'vitest';

import { setMuted } from './audio.js';

/**
 * Capture the raw string assigned to `document.cookie` (its attributes are not
 * observable via the getter, so a setter spy is the only way to assert them).
 * @returns The spy and a getter for the last written value.
 */
function captureCookieWrite(): { lastWrite: () => string; restore: () => void } {
  let written = '';
  const spy = vi.spyOn(document, 'cookie', 'set').mockImplementation((v: string) => {
    written = v;
  });
  return {
    lastWrite: () => written,
    restore: () => {
      spy.mockRestore();
    },
  };
}

/**
 * Override `window.location.protocol` for one test.
 * @param protocol - The protocol to report (e.g. 'https:').
 * @returns A restore function.
 */
function stubProtocol(protocol: string): () => void {
  const original = Object.getOwnPropertyDescriptor(window, 'location');
  // setMuted only reads `.protocol`, so a minimal stand-in is enough.
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { protocol },
  });
  return () => {
    if (original !== undefined) Object.defineProperty(window, 'location', original);
  };
}

describe('setMuted cookie attributes (#58)', () => {
  const cleanups: (() => void)[] = [];
  afterEach(() => {
    while (cleanups.length > 0) cleanups.pop()?.();
  });

  it('adds Secure on an HTTPS origin', () => {
    cleanups.push(stubProtocol('https:'));
    const cap = captureCookieWrite();
    cleanups.push(cap.restore);
    setMuted(true);
    expect(cap.lastWrite()).toContain('; Secure');
    expect(cap.lastWrite()).toContain('afixt_livechat_muted=1');
    expect(cap.lastWrite()).toContain('SameSite=Lax');
  });

  it('omits Secure on a plaintext HTTP origin (local dev)', () => {
    cleanups.push(stubProtocol('http:'));
    const cap = captureCookieWrite();
    cleanups.push(cap.restore);
    setMuted(false);
    expect(cap.lastWrite()).not.toContain('Secure');
    expect(cap.lastWrite()).toContain('afixt_livechat_muted=0');
  });
});
