import { create } from 'zustand';

/**
 * The operator's own availability as reflected in the console. `unknown` is
 * the pre-connect state before the server has echoed `availability:self`.
 */
export type ConsoleAvailability = 'available' | 'away' | 'unknown';

interface AvailabilityState {
  /** The current operator's own availability. */
  status: ConsoleAvailability;
  /** Replace the current status (from the server echo or an optimistic set). */
  setStatus: (status: ConsoleAvailability) => void;
}

/**
 * Zustand store holding the signed-in operator's own availability. Fed by the
 * `availability:self` socket echo so every tab and page reflects the same
 * per-user status (availability is per-user, not per-tab).
 */
export const useAvailabilityStore = create<AvailabilityState>()((set) => ({
  status: 'unknown',
  setStatus: (status) => {
    set({ status });
  },
}));
