import { createInvitationInputSchema, type CreateInvitationInput } from '@livechat/shared';

import { parsedBody, validate } from '../middlewares/validate.js';
import { asyncHandler } from '../utils/async-handler.js';

import { buildAdminRouter } from './admin-router.js';

import type { AdminRouterDeps } from './admin-router.js';
import type { InvitationService } from '../services/index.js';
import type { Router } from 'express';

interface InvitationsRouterDeps extends AdminRouterDeps {
  invitation: InvitationService;
}

/**
 * Build the `/invitations` sub-router (super_admin + admin only).
 * @param deps - Env, redis, invitation service.
 * @returns Express router.
 */
export function buildInvitationsRouter(deps: InvitationsRouterDeps): Router {
  const router = buildAdminRouter(deps);

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
