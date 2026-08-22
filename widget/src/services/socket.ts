import { io, type Socket } from 'socket.io-client';

import { getSessionToken } from './api.js';

let visitorSocket: Socket | null = null;

/**
 * Lazily connect to the /visitor Socket.IO namespace. Cookie-authenticated
 * (the signed visitor cookie is sent automatically on the WebSocket
 * handshake).
 *
 * Returns the existing instance whenever one exists — even mid-reconnect,
 * when `.connected` is false — because calling `.disconnect()` on a
 * reconnecting socket permanently kills socket.io's retry loop and orphans
 * every listener bound to it. socket.io reconnects on its own; a new socket
 * is created only when there is none (issue #69).
 * @returns The visitor socket (connected, connecting, or reconnecting).
 */
export function getVisitorSocket(): Socket {
  if (visitorSocket) return visitorSocket;
  visitorSocket = io('/visitor', {
    path: '/api/socket.io',
    transports: ['websocket'],
    withCredentials: true,
    // Handshake fallback for browsers that block the third-party cookie (#75):
    // the /visitor namespace reads `auth.cookie` when the Cookie header is
    // absent. Supplied as a callback rather than a fixed object because #69
    // keeps this socket for the process's lifetime — a token that arrives (or
    // is refreshed) after construction must still reach every reconnect
    // attempt, and socket.io re-invokes this before each one.
    auth: (cb: (data: Record<string, unknown>) => void) => {
      const token = getSessionToken();
      cb(token !== null ? { cookie: token } : {});
    },
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
