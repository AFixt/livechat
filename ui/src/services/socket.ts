import { io, type Socket } from 'socket.io-client';

import { useAuthStore } from '../store/auth.js';

let staffSocket: Socket | null = null;

/**
 * Lazily connect to the staff Socket.IO namespace using the current access
 * token.
 * @returns A connected (or connecting) socket.
 */
export function getStaffSocket(): Socket {
  if (staffSocket?.connected === true) return staffSocket;
  const token = useAuthStore.getState().accessToken;
  staffSocket?.disconnect();
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
