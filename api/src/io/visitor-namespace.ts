import { detach, guard, type SocketErrorPayload } from './detach.js';
import { GLOBAL_STAFF_ROOM } from './rooms.js';

import type { ServerToClientEvents, VisitorSocketData, VisitorToServerEvents } from './types.js';
import type { ChatCaller } from '../services/chat-service.js';
import type { Services } from '../services/index.js';
import type { Logger } from 'pino';
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
  logger: Logger;
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
    // A visitor may only ever touch chats bound to their own signed session
    // (issue #72).
    const caller: ChatCaller = { kind: 'visitor', visitorSessionId };
    const emitError = (payload: SocketErrorPayload): void => {
      socket.emit('chat:error', payload);
    };

    detach(deps.logger, 'visitor room join failed', async () => {
      await socket.join(`visitor:${visitorSessionId}`);
      // Join the tenant-wide room so this visitor receives
      // `support:availability_changed` broadcasts and can flip between the
      // invitation (§5.1.2) and no-support (§5.1.4) states in real time.
      await socket.join(`tenant:${tenantId}`);
    });

    detach(deps.logger, 'marking visitor present failed', async () =>
      deps.services.presence.markVisitorPresent(tenantId, visitorSessionId, {
        connectedAt: Date.now(),
      }),
    );
    deps.io.of(STAFF_NS).to(`tenant:${tenantId}`).to(GLOBAL_STAFF_ROOM).emit('visitor:joined', {
      tenantId,
      visitorSessionId,
    });

    socket.on('chat:join', (payload) => {
      guard(deps.logger, emitError, 'chat:join', async () => {
        // Resolve the chat scoped to this visitor first: a visitor must not be
        // able to join another visitor's chat room by id (#72).
        const chat = await deps.services.chat.getById(payload.chatId, caller);
        await socket.join(`chat:${payload.chatId}`);
        // Notify staff that this chat needs attention. Visitor-initiated
        // chats are created over HTTP, which emits nothing — without this
        // the chat never reaches the console's list. Idempotent: the client
        // upserts, so re-joining (e.g. restart) is harmless.
        deps.io.of(STAFF_NS).to(`tenant:${tenantId}`).to(GLOBAL_STAFF_ROOM).emit('chat:requested', {
          chatId: chat.id,
          tenantId,
          customerName: chat.customerName,
          status: chat.status,
        });
      });
    });

    socket.on('chat:message', (payload) => {
      guard(deps.logger, emitError, 'chat:message', async () => {
        const msg = await deps.services.chat.sendMessage(
          {
            chatId: payload.chatId,
            senderKind: 'visitor',
            body: payload.body,
          },
          caller,
        );
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
        deps.io
          .of(STAFF_NS)
          .to(`tenant:${tenantId}`)
          .to(GLOBAL_STAFF_ROOM)
          .emit('chat:message', event);
      });
    });

    socket.on('chat:typing', (payload) => {
      // Only relay typing for a chat this visitor has actually joined, so it
      // cannot be spoofed into another visitor's chat room (#72).
      if (!socket.rooms.has(`chat:${payload.chatId}`)) return;
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
      guard(deps.logger, emitError, 'chat:end', async () => {
        const chat = await deps.services.chat.endChat(
          { chatId: payload.chatId, endedBy: 'customer' },
          caller,
        );
        const event: Parameters<ServerToClientEvents['chat:ended']>[0] = {
          chatId: chat.id,
          endedBy: 'customer',
        };
        nsp.to(`chat:${chat.id}`).emit('chat:ended', event);
        deps.io.of(STAFF_NS).to(`chat:${chat.id}`).emit('chat:ended', event);
      });
    });

    socket.on('visitor:page_changed', (payload) => {
      deps.io
        .of(STAFF_NS)
        .to(`tenant:${tenantId}`)
        .to(GLOBAL_STAFF_ROOM)
        .emit('visitor:page_changed', {
          visitorSessionId,
          currentUrl: payload.currentUrl,
        });
    });

    socket.on('disconnect', () => {
      detach(deps.logger, 'visitor disconnect cleanup failed', async () => {
        await deps.services.presence.removeVisitor(tenantId, visitorSessionId);
        deps.io.of(STAFF_NS).to(`tenant:${tenantId}`).to(GLOBAL_STAFF_ROOM).emit('visitor:left', {
          tenantId,
          visitorSessionId,
        });
      });
    });
  });

  return nsp;
}
