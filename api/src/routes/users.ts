import { updateUserInputSchema, type UpdateUserInput } from '@livechat/shared';
import { Router } from 'express';

import { authenticate } from '../middlewares/authenticate.js';
import { requireRole } from '../middlewares/authorize.js';
import { parsedBody, validate } from '../middlewares/validate.js';
import { asyncHandler } from '../utils/async-handler.js';

import type { Env } from '../config/env.js';
import type { UserService } from '../services/index.js';
import type { Redis } from 'ioredis';

interface UsersRouterDeps {
  env: Env;
  redis: Redis;
  user: UserService;
}

/**
 * Build the `/users` sub-router (super_admin + admin).
 * @param deps - Env, redis, user service.
 * @returns Express router.
 */
export function buildUsersRouter(deps: UsersRouterDeps): Router {
  const router = Router();
  router.use(authenticate({ env: deps.env, redis: deps.redis }));
  router.use(requireRole('super_admin', 'admin'));

  router.get(
    '/',
    asyncHandler(async (req, res) => {
      const tenantId = req.query.tenantId;
      const users = await deps.user.list(typeof tenantId === 'string' ? tenantId : undefined);
      res.json({ success: true, data: users });
    }),
  );

  router.get(
    '/:id',
    asyncHandler(async (req, res) => {
      const id = req.params.id;
      if (typeof id !== 'string') return;
      const user = await deps.user.getById(id);
      res.json({ success: true, data: user });
    }),
  );

  router.patch(
    '/:id',
    validate({ body: updateUserInputSchema }),
    asyncHandler(async (req, res) => {
      const id = req.params.id;
      if (typeof id !== 'string') return;
      const body = parsedBody(req, updateUserInputSchema) satisfies UpdateUserInput;
      const user = await deps.user.update(id, body);
      res.json({ success: true, data: user });
    }),
  );

  return router;
}
