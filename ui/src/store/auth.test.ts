import { beforeEach, describe, expect, it } from 'vitest';

import { useAuthStore } from './auth.js';

import type { UserSafe } from '@livechat/shared';

/**
 * Documented-exception regression guard for ADR-0013
 * (`docs/adr/0013-jwt-localstorage-risk-acceptance.md`) and issue #59.
 *
 * The console deliberately persists the JWT access + refresh tokens to
 * `localStorage`. That is an *accepted, time-limited* risk, not an oversight —
 * so rather than assert "no token in storage", these tests assert the accepted
 * exception **explicitly** (issue #59 acceptance criterion 3). If the storage
 * model changes (e.g. the refresh token moves to an httpOnly cookie), these
 * tests change with it, which is the prompt to revisit ADR-0013.
 */

const STORAGE_KEY = 'livechat.auth';

const SAMPLE_USER = {
  id: 'user-1',
  email: 'operator@example.com',
  firstName: 'Op',
  lastName: 'Erator',
  role: 'staff',
} as unknown as UserSafe;

/**
 * Read and parse the Zustand-persisted auth snapshot from localStorage.
 * @returns The persisted `state` object, or `null` if nothing is stored.
 */
function readPersistedState(): { accessToken?: unknown; refreshToken?: unknown } | null {
  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (raw === null) return null;
  const parsed = JSON.parse(raw) as { state?: { accessToken?: unknown; refreshToken?: unknown } };
  return parsed.state ?? null;
}

describe('auth store — localStorage token persistence (ADR-0013 accepted exception)', () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
    useAuthStore.getState().clear();
  });

  it('persists BOTH the access and refresh token to localStorage under livechat.auth', () => {
    useAuthStore.getState().setSession({
      accessToken: 'access-token-value',
      refreshToken: 'refresh-token-value',
      user: SAMPLE_USER,
    });

    const persisted = readPersistedState();
    expect(persisted).not.toBeNull();
    // The accepted exception, pinned: if either of these stops being true, the
    // storage model has changed and ADR-0013 must be revisited.
    expect(persisted?.accessToken).toBe('access-token-value');
    expect(persisted?.refreshToken).toBe('refresh-token-value');
  });

  it('does NOT mirror the tokens into sessionStorage', () => {
    useAuthStore.getState().setSession({
      accessToken: 'access-token-value',
      refreshToken: 'refresh-token-value',
      user: SAMPLE_USER,
    });

    // The exception is scoped to localStorage only. sessionStorage is not a
    // real improvement against XSS (see ADR-0013) and must not accrue a second
    // copy of the tokens.
    const sessionDump = JSON.stringify(window.sessionStorage);
    expect(sessionDump).not.toContain('access-token-value');
    expect(sessionDump).not.toContain('refresh-token-value');
  });

  it('clears the persisted tokens on logout', () => {
    useAuthStore.getState().setSession({
      accessToken: 'access-token-value',
      refreshToken: 'refresh-token-value',
      user: SAMPLE_USER,
    });
    useAuthStore.getState().clear();

    const persisted = readPersistedState();
    // The key may remain with a nulled snapshot; the tokens themselves must go.
    expect(persisted?.accessToken ?? null).toBeNull();
    expect(persisted?.refreshToken ?? null).toBeNull();
    expect(window.localStorage.getItem(STORAGE_KEY) ?? '').not.toContain('access-token-value');
    expect(window.localStorage.getItem(STORAGE_KEY) ?? '').not.toContain('refresh-token-value');
  });
});
