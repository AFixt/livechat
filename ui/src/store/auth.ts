import { create } from 'zustand';
import { persist } from 'zustand/middleware';

import type { UserSafe } from '@livechat/shared';

interface AuthState {
  /** Current access token (JWT) or null if logged out. */
  accessToken: string | null;
  /** Current refresh token or null if logged out. */
  refreshToken: string | null;
  /** Safe user object or null. */
  user: UserSafe | null;
  /** Set the full auth snapshot after login/refresh. */
  setSession: (snapshot: { accessToken: string; refreshToken: string; user: UserSafe }) => void;
  /** Rotate the access token after a /refresh-token call. */
  setAccessToken: (accessToken: string, refreshToken?: string) => void;
  /** Clear all auth state (logout). */
  clear: () => void;
}

/**
 * Zustand store holding the authenticated session for the support console.
 * Persisted to localStorage so refreshes don't immediately log out.
 */
export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      accessToken: null,
      refreshToken: null,
      user: null,
      setSession: (snapshot) => {
        set({
          accessToken: snapshot.accessToken,
          refreshToken: snapshot.refreshToken,
          user: snapshot.user,
        });
      },
      setAccessToken: (accessToken, refreshToken) => {
        set((state) => ({
          accessToken,
          refreshToken: refreshToken ?? state.refreshToken,
        }));
      },
      clear: () => {
        set({ accessToken: null, refreshToken: null, user: null });
      },
    }),
    { name: 'livechat.auth' },
  ),
);
