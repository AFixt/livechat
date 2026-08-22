import { Router } from 'express';

import { authenticate } from '../middlewares/authenticate.js';
import { requireStaffOrAdmin } from '../middlewares/authorize.js';
import { ApiError } from '../utils/api-error.js';
import { asyncHandler } from '../utils/async-handler.js';
import { recordAudit } from '../utils/audit.js';

import type { Env } from '../config/env.js';
import type { IoRef } from '../io/io-ref.js';
import type { AuditService, PresenceService, VisitorSessionService } from '../services/index.js';
import type { Redis } from 'ioredis';

// Side-effect import: registers this router's OpenAPI paths (#119).
import './openapi/visitor-sessions.js';

interface VisitorSessionsRouterDeps {
  env: Env;
  redis: Redis;
  visitorSession: VisitorSessionService;
  presence: PresenceService;
  audit: AuditService;
  /**
   * Late-bound Socket.IO server, so a revoked visitor is disconnected
   * immediately rather than lingering on an already-authenticated socket.
   * Absent in unit tests that exercise the route without a server.
   */
  ioRef?: IoRef;
}

/**
 * Build the `/visitor-sessions` sub-router — staff-facing visitor session
 * management (#123).
 *
 * Separate from the public `/visitor` router on purpose: that one is
 * cookie-authenticated and belongs to the visitor, this one is JWT + staff.
 * @param deps - Env, redis, services, and the Socket.IO server.
 * @returns Express router.
 */
export function buildVisitorSessionsRouter(deps: VisitorSessionsRouterDeps): Router {
  const router = Router();
  router.use(authenticate({ env: deps.env, redis: deps.redis }));
  router.use(requireStaffOrAdmin());

  router.delete(
    '/:id',
    asyncHandler(async (req, res) => {
      const id = req.params.id;
      if (typeof id !== 'string' || id === '') throw ApiError.badRequest('Session id is required');
      // `tenantId === null` is an untenanted AFixt operator, who spans every
      // tenant (#19); a tenanted caller is confined to their own.
      const callerTenantId = req.user?.tenantId ?? null;
      const revoked = await deps.visitorSession.revokeById(id, callerTenantId);

      // Drop them from presence so the console's visitor list stops showing a
      // session that no longer exists.
      await deps.presence.removeVisitor(revoked.tenantId, revoked.id);

      const io = deps.ioRef?.current ?? null;
      if (io !== null) {
        // Close any live socket. The session row is already gone, so the
        // handshake would reject a reconnect — but an *established* socket was
        // authenticated at connect time and would otherwise keep working.
        // `disconnectSockets` goes through the adapter, so it reaches sockets
        // on other nodes too (#73).
        io.of('/visitor').in(`visitor:${revoked.id}`).disconnectSockets(true);
        io.of('/staff')
          .to(`tenant:${revoked.tenantId}`)
          .emit('visitor:left', { visitorSessionId: revoked.id });
      }

      await recordAudit(deps.audit, req, {
        action: 'visitor_session.revoke',
        resourceType: 'visitor_session',
        resourceId: revoked.id,
      });

      res.json({ success: true });
    }),
  );

  return router;
}
