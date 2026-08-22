import { getApi } from './api.js';

/**
 * Revoke a visitor's session (#123). The row is hard-deleted server-side, so
 * the visitor's cookie stops working on both the HTTP routes and the socket
 * handshake, and any live socket is closed.
 * @param visitorSessionId - The visitor session to revoke.
 */
export async function revokeVisitorSession(visitorSessionId: string): Promise<void> {
  await getApi().delete(`/visitor-sessions/${encodeURIComponent(visitorSessionId)}`);
}
