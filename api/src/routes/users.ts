import { updateUserInputSchema, type UpdateUserInput } from '@livechat/shared';

import { assertTenantAccess, resolveTenantFilter } from '../middlewares/authorize.js';
import { parsedBody, validate } from '../middlewares/validate.js';
import { asyncHandler } from '../utils/async-handler.js';

import { buildAdminRouter } from './admin-router.js';

import type { AdminRouterDeps } from './admin-router.js';
import type { UserService } from '../services/index.js';
import type { Router } from 'express';

interface UsersRouterDeps extends AdminRouterDeps {
  user: UserService;
}

/**
 * Build the `/users` sub-router (super_admin + admin).
 * @param deps - Env, redis, user service.
 * @returns Express router.
 */
export function buildUsersRouter(deps: UsersRouterDeps): Router {
  const router = buildAdminRouter(deps);

  router.get(
    '/',
    asyncHandler(async (req, res) => {
      const users = await deps.user.list(resolveTenantFilter(req, req.query.tenantId));
      res.json({ success: true, data: users });
    }),
  );

  router.get(
    '/:id',
    asyncHandler(async (req, res) => {
      const id = req.params.id;
      if (typeof id !== 'string') return;
      const user = await deps.user.getById(id);
      assertTenantAccess(req, user.tenantId);
      res.json({ success: true, data: user });
    }),
  );

  router.patch(
    '/:id',
    validate({ body: updateUserInputSchema }),
    asyncHandler(async (req, res) => {
      const id = req.params.id;
      if (typeof id !== 'string') return;
      // Check the existing row's tenant before mutating it, so a scoped caller
      // cannot edit — or re-tenant — someone else's user.
      const existing = await deps.user.getById(id);
      assertTenantAccess(req, existing.tenantId);
      const body = parsedBody(req, updateUserInputSchema) satisfies UpdateUserInput;
      const user = await deps.user.update(id, body);
      res.json({ success: true, data: user });
    }),
  );

  return router;
}
