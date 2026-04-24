import jwt from 'jsonwebtoken';

import type { ServerToClientEvents, StaffSocketData, StaffToServerEvents } from './types.js';
import type { Env } from '../config/env.js';
import type { Services } from '../services/index.js';
import type { Namespace, Server, Socket } from 'socket.io';

/**
 *
 */
type StaffNamespace = Namespace<StaffToServerEvents, ServerToClientEvents, object, StaffSocketData>;
/**
 *
 */
type StaffSocket = Socket<StaffToServerEvents, ServerToClientEvents, object, StaffSocketData>;

interface JwtPayload {
  sub: string;
  role: string;
  tenantId: string | null;
  jti: string;
}

interface StaffDeps {
  io: Server;
  env: Pick<Env, 'JWT_ACCESS_SECRET'>;
  services: Pick<Services, 'chat' | 'presence'>;
}

/**
 * Register the `/staff` Socket.IO namespace — JWT-authenticated support and
 * admin users.
 * @param deps - Server, env, and services.
 * @returns The namespace (in case caller wants to emit to it).
 */
export function registerStaffNamespace(deps: StaffDeps): StaffNamespace {
  const nsp = deps.io.of('/staff') as StaffNamespace;

  nsp.use((socket, next) => {
    const token = socket.handshake.auth.token as string | undefined;
    if (token === undefined) {
      next(new Error('Authentication required'));
      return;
    }
    try {
      const decoded = jwt.verify(token, deps.env.JWT_ACCESS_SECRET) as JwtPayload;
      socket.data.userId = decoded.sub;
      socket.data.role = decoded.role;
      socket.data.tenantId = decoded.tenantId;
      next();
    } catch {
      next(new Error('Invalid token'));
    }
  });

  nsp.on('connection', (socket: StaffSocket) => {
    const { userId, role, tenantId } = socket.data;
    void socket.join(`user:${userId}`);
    if (['super_admin', 'admin', 'staff'].includes(role)) {
      void socket.join('staff');
      void deps.services.presence.setStaffAvailable(userId);
      nsp.emit('support:availability_changed', { available: true });
    }
    if (tenantId !== null) void socket.join(`tenant:${tenantId}`);

    socket.on('chat:accept', (payload) => {
      void (async () => {
        const chat = await deps.services.chat.assign(payload.chatId, userId);
        void socket.join(`chat:${chat.id}`);
        const assigned = { chatId: chat.id, assignedTo: userId };
        nsp.to(`chat:${chat.id}`).emit('chat:assigned', assigned);
        deps.io.of('/visitor').to(`chat:${chat.id}`).emit('chat:assigned', assigned);
      })();
    });

    socket.on('chat:message', (payload) => {
      void (async () => {
        const msg = await deps.services.chat.sendMessage({
          chatId: payload.chatId,
          senderKind: 'user',
          senderUserId: userId,
          body: payload.body,
        });
        const event = {
          chatId: payload.chatId,
          messageId: msg.id,
          senderKind: 'user' as const,
          senderUserId: userId,
          body: msg.body,
          deliveredAt: msg.deliveredAt.toISOString(),
        };
        nsp.to(`chat:${payload.chatId}`).emit('chat:message', event);
        deps.io.of('/visitor').to(`chat:${payload.chatId}`).emit('chat:message', event);
      })();
    });

    socket.on('chat:typing', (payload) => {
      const typingEvent = {
        chatId: payload.chatId,
        actor: 'user' as const,
        isTyping: payload.isTyping,
      };
      nsp.to(`chat:${payload.chatId}`).emit('chat:typing', typingEvent);
      deps.io.of('/visitor').to(`chat:${payload.chatId}`).emit('chat:typing', typingEvent);
    });

    socket.on('chat:end', (payload) => {
      void (async () => {
        const chat = await deps.services.chat.endChat({
          chatId: payload.chatId,
          endedBy: 'support',
        });
        const endEvent = { chatId: chat.id, endedBy: 'support' as const };
        nsp.to(`chat:${chat.id}`).emit('chat:ended', endEvent);
        deps.io.of('/visitor').to(`chat:${chat.id}`).emit('chat:ended', endEvent);
      })();
    });

    socket.on('chat:initiate', (payload) => {
      void (async () => {
        if (tenantId === null) return;
        const chat = await deps.services.chat.initiateBySupport({
          tenantId,
          visitorSessionId: payload.visitorSessionId,
          supportUserId: userId,
        });
        void socket.join(`chat:${chat.id}`);
        nsp.to(`tenant:${chat.tenantId}`).emit('chat:requested', {
          chatId: chat.id,
          tenantId: chat.tenantId,
        });
      })();
    });

    socket.on('disconnect', () => {
      if (['super_admin', 'admin', 'staff'].includes(role)) {
        void (async () => {
          await deps.services.presence.setStaffUnavailable(userId);
          const anyLeft = await deps.services.presence.anyStaffAvailable();
          if (!anyLeft) {
            nsp.emit('support:availability_changed', { available: false });
          }
        })();
      }
    });
  });

  return nsp;
}
