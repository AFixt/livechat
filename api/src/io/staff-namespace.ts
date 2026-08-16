import { availabilityStatusSchema } from '@livechat/shared';
import jwt from 'jsonwebtoken';

import { GLOBAL_STAFF_TENANT } from '../services/presence-service.js';

import { broadcastTenantAvailability } from './availability.js';
import { detach } from './detach.js';
import { GLOBAL_STAFF_ROOM } from './rooms.js';

import type { ServerToClientEvents, StaffSocketData, StaffToServerEvents } from './types.js';
import type { Env } from '../config/env.js';
import type { Services } from '../services/index.js';
import type { Logger } from 'pino';
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
  logger: Logger;
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
    detach(deps.logger, 'staff room join failed', async () => {
      await socket.join(`user:${userId}`);
      if (['super_admin', 'admin', 'staff'].includes(role)) {
        await socket.join('staff');
        // AFixt staff with no tenant of their own serve every tenant, so they
        // join the global room that visitor/chat events are mirrored to. Note
        // the `staff` room is NOT used for that — it holds tenant-scoped staff
        // too, and broadcasting there would break tenant isolation.
        if (tenantId === null) await socket.join(GLOBAL_STAFF_ROOM);
      }
      if (tenantId !== null) await socket.join(`tenant:${tenantId}`);
    });
    const isStaff = ['super_admin', 'admin', 'staff'].includes(role);
    // Untenanted AFixt staff serve every tenant (issue #19); bucket their
    // availability globally rather than under a single tenant.
    const availabilityTenant = tenantId ?? GLOBAL_STAFF_TENANT;
    if (isStaff) {
      detach(deps.logger, 'restoring staff availability failed', async () => {
        // Do NOT auto-mark available on connect: keep the user's persisted,
        // explicit status so availability survives reconnects/reloads.
        const status = await deps.services.presence.restoreOnConnect(userId, availabilityTenant);
        nsp.to(`user:${userId}`).emit('availability:self', { status });
        if (tenantId !== null) {
          await broadcastTenantAvailability({
            io: deps.io,
            presence: deps.services.presence,
            tenantId,
          });
        }
      });
    }

    socket.on('chat:accept', (payload) => {
      detach(deps.logger, 'staff chat:accept failed', async () => {
        const chat = await deps.services.chat.assign(payload.chatId, userId);
        await socket.join(`chat:${chat.id}`);
        const assigned = { chatId: chat.id, assignedTo: userId };
        nsp.to(`chat:${chat.id}`).emit('chat:assigned', assigned);
        deps.io.of('/visitor').to(`chat:${chat.id}`).emit('chat:assigned', assigned);
      });
    });

    socket.on('chat:message', (payload) => {
      detach(deps.logger, 'staff chat:message failed', async () => {
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
      });
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
      detach(deps.logger, 'staff chat:end failed', async () => {
        const chat = await deps.services.chat.endChat({
          chatId: payload.chatId,
          endedBy: 'support',
        });
        const endEvent = { chatId: chat.id, endedBy: 'support' as const };
        nsp.to(`chat:${chat.id}`).emit('chat:ended', endEvent);
        deps.io.of('/visitor').to(`chat:${chat.id}`).emit('chat:ended', endEvent);
      });
    });

    socket.on('chat:initiate', (payload) => {
      detach(deps.logger, 'staff chat:initiate failed', async () => {
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

    socket.on('availability:set', (payload) => {
      if (!isStaff) return;
      // Validate at runtime: the payload is untrusted socket input (a client
      // can emit anything, including no payload), so a malformed status must
      // not be persisted or echoed back to the client.
      const raw = payload as { status?: unknown } | null | undefined;
      const parsed = availabilityStatusSchema.safeParse(raw?.status);
      if (!parsed.success) return;
      const status = parsed.data;
      detach(deps.logger, 'staff availability:set failed', async () => {
        await deps.services.presence.setAvailability(userId, availabilityTenant, status);
        // Echo to every tab of this user so the console reflects the change
        // and multi-tab stays in sync (availability is per-user, not per-tab).
        nsp.to(`user:${userId}`).emit('availability:self', { status });
        if (tenantId !== null) {
          await broadcastTenantAvailability({
            io: deps.io,
            presence: deps.services.presence,
            tenantId,
          });
        }
      });
    });

    socket.on('availability:heartbeat', () => {
      if (!isStaff) return;
      detach(deps.logger, 'staff availability:heartbeat failed', async () =>
        deps.services.presence.heartbeat(userId),
      );
    });

    // No availability change on disconnect: status is explicit and persists.
    // A full disconnect (all tabs closed, heartbeats stop) stops the agent
    // counting only once the connection grace window lapses — a dropped
    // socket never flips them away immediately.
  });

  return nsp;
}
