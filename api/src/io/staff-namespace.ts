import { authenticateAccessToken } from '../middlewares/authenticate.js';

import { detach, guard, type SocketErrorPayload } from './detach.js';
import { GLOBAL_STAFF_ROOM } from './rooms.js';

import type { ServerToClientEvents, StaffSocketData, StaffToServerEvents } from './types.js';
import type { Env } from '../config/env.js';
import type { ChatCaller } from '../services/chat-service.js';
import type { Services } from '../services/index.js';
import type { Redis } from 'ioredis';
import type { Logger } from 'pino';
import type { Namespace, Server, Socket } from 'socket.io';

/** Roles that may open a `/staff` socket and act on chats. */
const STAFF_ROLES = ['super_admin', 'admin', 'staff'];

/**
 *
 */
type StaffNamespace = Namespace<StaffToServerEvents, ServerToClientEvents, object, StaffSocketData>;
/**
 *
 */
type StaffSocket = Socket<StaffToServerEvents, ServerToClientEvents, object, StaffSocketData>;

interface StaffDeps {
  io: Server;
  logger: Logger;
  env: Pick<Env, 'JWT_ACCESS_SECRET'>;
  redis: Redis;
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
    (async () => {
      const token = socket.handshake.auth.token as string | undefined;
      if (token === undefined) {
        next(new Error('Authentication required'));
        return;
      }
      // Reuse the full HTTP auth path (JTI blacklist, active status, tenant
      // expiry) so a logged-out or deactivated token cannot keep a live socket
      // for the rest of its ~15-minute lifetime (issue #72).
      let userId: string;
      let role: string;
      let tenantId: string | null;
      try {
        const { user } = await authenticateAccessToken({ env: deps.env, redis: deps.redis }, token);
        ({ id: userId, role, tenantId } = user);
      } catch {
        next(new Error('Invalid token'));
        return;
      }
      if (!STAFF_ROLES.includes(role)) {
        next(new Error('Insufficient permissions'));
        return;
      }
      socket.data.userId = userId;
      socket.data.role = role;
      socket.data.tenantId = tenantId;
      next();
    })().catch(next);
  });

  nsp.on('connection', (socket: StaffSocket) => {
    const { userId, tenantId } = socket.data;
    // The handshake already rejected any non-staff role, so every connected
    // socket is a staff operator. `tenantId === null` is an untenanted AFixt
    // operator who serves every tenant (issue #72).
    const caller: ChatCaller = { kind: 'staff', tenantId };
    const emitError = (payload: SocketErrorPayload): void => {
      socket.emit('chat:error', payload);
    };

    detach(deps.logger, 'staff room join failed', async () => {
      await socket.join(`user:${userId}`);
      await socket.join('staff');
      // AFixt staff with no tenant of their own serve every tenant, so they
      // join the global room that visitor/chat events are mirrored to. Note
      // the `staff` room is NOT used for that — it holds tenant-scoped staff
      // too, and broadcasting there would break tenant isolation.
      if (tenantId === null) await socket.join(GLOBAL_STAFF_ROOM);
      else await socket.join(`tenant:${tenantId}`);
    });
    detach(deps.logger, 'marking staff available failed', async () =>
      deps.services.presence.setStaffAvailable(userId),
    );
    nsp.emit('support:availability_changed', { available: true });

    socket.on('chat:accept', (payload) => {
      guard(deps.logger, emitError, 'chat:accept', async () => {
        const chat = await deps.services.chat.assign(payload.chatId, userId, caller);
        await socket.join(`chat:${chat.id}`);
        const assigned = { chatId: chat.id, assignedTo: userId };
        nsp.to(`chat:${chat.id}`).emit('chat:assigned', assigned);
        deps.io.of('/visitor').to(`chat:${chat.id}`).emit('chat:assigned', assigned);
      });
    });

    socket.on('chat:join', (payload) => {
      guard(deps.logger, emitError, 'chat:join', async () => {
        // Re-enter a chat room the operator already had open (e.g. after a
        // reconnect) without touching assignment (issue #69). `getById`
        // enforces the same tenant scoping as `chat:accept` — a null-tenant
        // AFixt operator spans all tenants, a scoped one is limited to theirs
        // (#72) — so a client-supplied chatId cannot cross the boundary.
        const chat = await deps.services.chat.getById(payload.chatId, caller);
        await socket.join(`chat:${chat.id}`);
      });
    });

    socket.on('chat:message', (payload) => {
      guard(deps.logger, emitError, 'chat:message', async () => {
        const msg = await deps.services.chat.sendMessage(
          {
            chatId: payload.chatId,
            senderKind: 'user',
            senderUserId: userId,
            body: payload.body,
          },
          caller,
        );
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
      });
    });

    socket.on('chat:typing', (payload) => {
      // Only relay typing for a chat this socket has actually joined, so a
      // typing packet cannot be spoofed into an arbitrary chat room (#72).
      if (!socket.rooms.has(`chat:${payload.chatId}`)) return;
      const typingEvent = {
        chatId: payload.chatId,
        actor: 'user' as const,
        isTyping: payload.isTyping,
      };
      nsp.to(`chat:${payload.chatId}`).emit('chat:typing', typingEvent);
      deps.io.of('/visitor').to(`chat:${payload.chatId}`).emit('chat:typing', typingEvent);
    });

    socket.on('chat:end', (payload) => {
      guard(deps.logger, emitError, 'chat:end', async () => {
        const chat = await deps.services.chat.endChat(
          { chatId: payload.chatId, endedBy: 'support' },
          caller,
        );
        const endEvent = { chatId: chat.id, endedBy: 'support' as const };
        nsp.to(`chat:${chat.id}`).emit('chat:ended', endEvent);
        deps.io.of('/visitor').to(`chat:${chat.id}`).emit('chat:ended', endEvent);
      });
    });

    socket.on('chat:initiate', (payload) => {
      guard(deps.logger, emitError, 'chat:initiate', async () => {
        if (tenantId === null) return;
        const chat = await deps.services.chat.initiateBySupport({
          tenantId,
          visitorSessionId: payload.visitorSessionId,
          supportUserId: userId,
        });
        await socket.join(`chat:${chat.id}`);
        nsp.to(`tenant:${chat.tenantId}`).to(GLOBAL_STAFF_ROOM).emit('chat:requested', {
          chatId: chat.id,
          tenantId: chat.tenantId,
          customerName: chat.customerName,
          status: chat.status,
        });
        // Notify the visitor's own room (they have not joined the chat room
        // yet) so the widget can show the support-initiated invitation.
        deps.io
          .of('/visitor')
          .to(`visitor:${payload.visitorSessionId}`)
          .emit('support:initiated', { chatId: chat.id });
      });
    });

    socket.on('disconnect', () => {
      detach(deps.logger, 'staff disconnect cleanup failed', async () => {
        await deps.services.presence.setStaffUnavailable(userId);
        const anyLeft = await deps.services.presence.anyStaffAvailable();
        if (!anyLeft) {
          nsp.emit('support:availability_changed', { available: false });
        }
      });
    });
  });

  return nsp;
}
