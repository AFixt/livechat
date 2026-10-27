import { createInvitationInputSchema, type CreateInvitationInput } from '@livechat/shared';

import { callerTenantScope, resolveTenantFilter } from '../middlewares/authorize.js';
import { parsedBody, validate } from '../middlewares/validate.js';
import { asyncHandler } from '../utils/async-handler.js';

import { buildAdminRouter } from './admin-router.js';

import type { AdminRouterDeps } from './admin-router.js';
import type { InvitationService } from '../services/index.js';
import type { Router } from 'express';

// Side-effect import: registers the admin routers' OpenAPI paths (#119).
import './openapi/admin.js';

interface InvitationsRouterDeps extends AdminRouterDeps {
  invitation: InvitationService;
}

/**
 * Build the `/invitations` sub-router (super_admin + admin only), confined to
 * the caller's tenant for tenant-scoped admins (#196).
 * @param deps - Env, redis, invitation service.
 * @returns Express router.
 */
export function buildInvitationsRouter(deps: InvitationsRouterDeps): Router {
  const router = buildAdminRouter(deps);

  router.get(
    '/',
    asyncHandler(async (req, res) => {
      // A tenant-scoped caller sees only their own tenant's invitations (#196).
      const list = await deps.invitation.list(resolveTenantFilter(req, req.query.tenantId));
      res.json({ success: true, data: list });
    }),
  );

  router.post(
    '/',
    validate({ body: createInvitationInputSchema }),
    asyncHandler(async (req, res) => {
      if (req.user === undefined) return;
      const body = parsedBody(req, createInvitationInputSchema) satisfies CreateInvitationInput;
      const invitation = await deps.invitation.create(body, req.user);
      res.status(201).json({ success: true, data: invitation });
    }),
  );

  router.post(
    '/:id/revoke',
    asyncHandler(async (req, res) => {
      const id = req.params.id;
      if (typeof id !== 'string') return;
      await deps.invitation.revoke(id, callerTenantScope(req));
      res.json({ success: true });
    }),
  );

  return router;
}
