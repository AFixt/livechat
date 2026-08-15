import { io, type Socket } from 'socket.io-client';

import { getSessionToken } from './api.js';

let visitorSocket: Socket | null = null;

/**
 * Lazily connect to the /visitor Socket.IO namespace. Cookie-authenticated
 * (the signed visitor cookie is sent automatically on the WebSocket
 * handshake).
 * @returns The connected (or connecting) socket.
 */
export function getVisitorSocket(): Socket {
  if (visitorSocket?.connected === true) return visitorSocket;
  visitorSocket?.disconnect();
  const token = getSessionToken();
  visitorSocket = io('/visitor', {
    path: '/api/socket.io',
    transports: ['websocket'],
    withCredentials: true,
    // Handshake fallback for browsers that block the third-party cookie (#75):
    // the /visitor namespace reads `auth.cookie` when the Cookie header is absent.
    ...(token !== null && { auth: { cookie: token } }),
  });
  return visitorSocket;
}

/**
 * Close the visitor socket. Call on chat end or widget unmount.
 */
export function disconnectVisitorSocket(): void {
  visitorSocket?.disconnect();
  visitorSocket = null;
}
