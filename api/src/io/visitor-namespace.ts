import type { ServerToClientEvents, VisitorSocketData, VisitorToServerEvents } from './types.js';
import type { Services } from '../services/index.js';
import type { Namespace, Server, Socket } from 'socket.io';

/** Socket.IO namespace typed for the visitor-side vocabulary. */
type VisitorNamespace = Namespace<
  VisitorToServerEvents,
  ServerToClientEvents,
  object,
  VisitorSocketData
>;

/** A single visitor-side socket on {@link VisitorNamespace}. */
type VisitorSocket = Socket<VisitorToServerEvents, ServerToClientEvents, object, VisitorSocketData>;

const COOKIE_NAME = 'livechat_visitor';
const STAFF_NS = '/staff';

interface VisitorDeps {
  io: Server;
  services: Pick<Services, 'chat' | 'presence' | 'visitorSession'>;
}

/**
 * Pull a single cookie out of a `Cookie:` header value.
 * @param header - The raw `Cookie` header (or undefined).
 * @param name - The cookie name to extract.
 * @returns The decoded cookie value, or undefined if not present.
 */
function extractCookie(header: string | undefined, name: string): string | undefined {
  if (header === undefined) return undefined;
  for (const part of header.split(';')) {
    const trimmed = part.trim();
    if (trimmed.startsWith(`${name}=`)) return trimmed.slice(name.length + 1);
  }
  return undefined;
}

/**
 * Register the `/visitor` Socket.IO namespace — authenticated by the signed
 * visitor cookie rather than a JWT.
 * @param deps - Server + services.
 * @returns The namespace.
 */
export function registerVisitorNamespace(deps: VisitorDeps): VisitorNamespace {
  const nsp = deps.io.of('/visitor') as VisitorNamespace;

  nsp.use((socket, next) => {
    (async () => {
      const cookieValue =
        (socket.handshake.auth.cookie as string | undefined) ??
        extractCookie(socket.handshake.headers.cookie, COOKIE_NAME);
      if (cookieValue === undefined) {
        next(new Error('Visitor cookie required'));
        return;
      }
      try {
        const session = await deps.services.visitorSession.findByCookie(cookieValue);
        socket.data.visitorSessionId = session.id;
        socket.data.tenantId = session.tenantId;
        next();
      } catch {
        next(new Error('Invalid visitor cookie'));
      }
    })().catch(next);
  });

  nsp.on('connection', (socket: VisitorSocket) => {
    const { visitorSessionId, tenantId } = socket.data;
    void socket.join(`visitor:${visitorSessionId}`);

    void deps.services.presence.markVisitorPresent(tenantId, visitorSessionId, {
      connectedAt: Date.now(),
    });
    deps.io.of(STAFF_NS).to(`tenant:${tenantId}`).emit('visitor:joined', {
      tenantId,
      visitorSessionId,
    });

    socket.on('chat:join', (payload) => {
      void socket.join(`chat:${payload.chatId}`);
    });

    socket.on('chat:message', (payload) => {
      void (async () => {
        const msg = await deps.services.chat.sendMessage({
          chatId: payload.chatId,
          senderKind: 'visitor',
          body: payload.body,
        });
        const event: Parameters<ServerToClientEvents['chat:message']>[0] = {
          chatId: payload.chatId,
          messageId: msg.id,
          senderKind: 'visitor',
          senderUserId: null,
          body: msg.body,
          deliveredAt: msg.deliveredAt.toISOString(),
        };
        nsp.to(`chat:${payload.chatId}`).emit('chat:message', event);
        deps.io.of(STAFF_NS).to(`chat:${payload.chatId}`).emit('chat:message', event);
        deps.io.of(STAFF_NS).to(`tenant:${tenantId}`).emit('chat:message', event);
      })();
    });

    socket.on('chat:typing', (payload) => {
      nsp.to(`chat:${payload.chatId}`).emit('chat:typing', {
        chatId: payload.chatId,
        actor: 'visitor',
        isTyping: payload.isTyping,
      });
      deps.io.of(STAFF_NS).to(`chat:${payload.chatId}`).emit('chat:typing', {
        chatId: payload.chatId,
        actor: 'visitor',
        isTyping: payload.isTyping,
      });
    });

    socket.on('chat:end', (payload) => {
      void (async () => {
        const chat = await deps.services.chat.endChat({
          chatId: payload.chatId,
          endedBy: 'customer',
        });
        const event: Parameters<ServerToClientEvents['chat:ended']>[0] = {
          chatId: chat.id,
          endedBy: 'customer',
        };
        nsp.to(`chat:${chat.id}`).emit('chat:ended', event);
        deps.io.of(STAFF_NS).to(`chat:${chat.id}`).emit('chat:ended', event);
      })();
    });

    socket.on('visitor:page_changed', (payload) => {
      deps.io.of(STAFF_NS).to(`tenant:${tenantId}`).emit('visitor:page_changed', {
        visitorSessionId,
        currentUrl: payload.currentUrl,
      });
    });

    socket.on('disconnect', () => {
      void (async () => {
        await deps.services.presence.removeVisitor(tenantId, visitorSessionId);
        deps.io.of(STAFF_NS).to(`tenant:${tenantId}`).emit('visitor:left', {
          tenantId,
          visitorSessionId,
        });
      })();
    });
  });

  return nsp;
}
