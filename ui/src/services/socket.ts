import { io, type Socket } from 'socket.io-client';

import { useAuthStore } from '../store/auth.js';

let staffSocket: Socket | null = null;

/**
 * Lazily connect to the staff Socket.IO namespace using the current access
 * token.
 *
 * Returns the existing instance whenever one exists — even mid-reconnect,
 * when `.connected` is false — because calling `.disconnect()` on a
 * reconnecting socket permanently kills socket.io's retry loop and orphans
 * every listener bound to it. socket.io reconnects on its own; a new socket
 * (with a fresh token) is created only on logout via
 * {@link disconnectStaffSocket} (issue #69).
 * @returns The staff socket (connected, connecting, or reconnecting).
 */
export function getStaffSocket(): Socket {
  if (staffSocket) return staffSocket;
  const token = useAuthStore.getState().accessToken;
  staffSocket = io('/staff', {
    path: '/api/socket.io',
    auth: { token },
    transports: ['websocket'],
  });
  return staffSocket;
}

/**
 * Tear down the staff socket. Call on logout.
 */
export function disconnectStaffSocket(): void {
  staffSocket?.disconnect();
  staffSocket = null;
}
