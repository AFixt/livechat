import type { Server } from 'socket.io';

/**
 * A late-bound handle on the Socket.IO server.
 *
 * The Express app is constructed *before* Socket.IO, because `attachIo` needs
 * the HTTP server that wraps the app. Routes that must reach into the socket
 * layer — revoking a visitor session has to close their live socket (#123) —
 * therefore cannot be handed the server at build time. `server.ts` fills this
 * in immediately after `attachIo`, and a route reads it per request, by which
 * point it is always populated.
 *
 * An explicit ref rather than a module-level singleton so tests can supply
 * their own (or none) without leaking state between suites.
 */
export interface IoRef {
  current: Server | null;
}

/**
 * Create an empty {@link IoRef}.
 * @returns A ref whose `current` is null until the server is attached.
 */
export function createIoRef(): IoRef {
  return { current: null };
}
