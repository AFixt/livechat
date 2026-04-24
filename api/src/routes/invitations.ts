import { createInvitationInputSchema, type CreateInvitationInput } from '@livechat/shared';
import { Router } from 'express';

import { authenticate } from '../middlewares/authenticate.js';
import { requireRole } from '../middlewares/authorize.js';
import { parsedBody, validate } from '../middlewares/validate.js';
import { asyncHandler } from '../utils/async-handler.js';

import type { Env } from '../config/env.js';
import type { InvitationService } from '../services/index.js';
import type { Redis } from 'ioredis';

interface InvitationsRouterDeps {
  env: Env;
  redis: Redis;
  invitation: InvitationService;
}

/**
 * Build the `/invitations` sub-router (super_admin + admin only).
 * @param deps - Env, redis, invitation service.
 * @returns Express router.
 */
export function buildInvitationsRouter(deps: InvitationsRouterDeps): Router {
  const router = Router();
  router.use(authenticate({ env: deps.env, redis: deps.redis }));
  router.use(requireRole('super_admin', 'admin'));

  router.get(
    '/',
    asyncHandler(async (req, res) => {
      const tenantId = req.query.tenantId;
      const list = await deps.invitation.list(typeof tenantId === 'string' ? tenantId : undefined);
      res.json({ success: true, data: list });
    }),
  );

  router.post(
    '/',
    validate({ body: createInvitationInputSchema }),
    asyncHandler(async (req, res) => {
      if (req.user === undefined) return;
      const body = parsedBody(req, createInvitationInputSchema) satisfies CreateInvitationInput;
      const invitation = await deps.invitation.create(body, req.user.id);
      res.status(201).json({ success: true, data: invitation });
    }),
  );

  router.post(
    '/:id/revoke',
    asyncHandler(async (req, res) => {
      const id = req.params.id;
      if (typeof id !== 'string') return;
      await deps.invitation.revoke(id);
      res.json({ success: true });
    }),
  );

  return router;
}
