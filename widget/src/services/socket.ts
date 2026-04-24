import { io, type Socket } from 'socket.io-client';

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
