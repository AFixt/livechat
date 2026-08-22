import { io, type Socket } from 'socket.io-client';

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
