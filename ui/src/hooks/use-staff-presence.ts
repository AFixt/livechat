import { useEffect } from 'react';

import { getStaffSocket } from '../services/socket.js';
import { useAvailabilityStore } from '../store/availability.js';

/** How often to refresh the server-side connection-liveness grace window. */
const HEARTBEAT_INTERVAL_MS = 45_000;

/**
 * Keep the signed-in operator's availability in sync for the lifetime of the
 * authenticated shell. Listens for the `availability:self` echo (so the
 * console reflects the persisted status on reload and stays consistent across
 * tabs) and sends a periodic heartbeat that refreshes the connection grace
 * window, so a brief socket drop never flips the agent away.
 */
export function useStaffPresence(): void {
  const setStatus = useAvailabilityStore((s) => s.setStatus);

  useEffect(() => {
    const socket = getStaffSocket();
    const onSelf = (payload: { status: 'available' | 'away' }): void => {
      setStatus(payload.status);
    };
    const sendHeartbeat = (): void => {
      socket.emit('availability:heartbeat');
    };

    socket.on('availability:self', onSelf);
    sendHeartbeat();
    const timer = window.setInterval(sendHeartbeat, HEARTBEAT_INTERVAL_MS);

    return () => {
      socket.off('availability:self', onSelf);
      window.clearInterval(timer);
    };
  }, [setStatus]);
}
