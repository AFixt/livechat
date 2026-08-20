import { create } from 'zustand';

/**
 * Live-updates connection status for the console.
 *
 * - `connected` — the staff socket is up; no banner.
 * - `reconnecting` — the socket dropped and socket.io is retrying; the banner
 *   is shown and announced.
 * - `reconnected` — the socket just came back; a transient confirmation is
 *   shown and announced before the banner clears itself back to `connected`.
 */
export type ConnectionStatus = 'connected' | 'reconnecting' | 'reconnected';

interface ConnectionState {
  /** Current staff-socket connection status. */
  status: ConnectionStatus;
  /** Set the connection status. */
  setStatus: (status: ConnectionStatus) => void;
}

/**
 * Zustand store holding the staff socket's connection status (issue #69). Kept
 * separate from the chats store so the reconnect banner can subscribe to just
 * this slice without re-rendering on every message. Driven by
 * {@link useStaffSocket}; read by `<ConnectionBanner>`.
 */
export const useConnectionStore = create<ConnectionState>()((set) => ({
  status: 'connected',
  setStatus: (status) => {
    set({ status });
  },
}));
