import { Router } from 'express';

import { authenticate } from '../middlewares/authenticate.js';
import { requireRole } from '../middlewares/authorize.js';

import type { Env } from '../config/env.js';
import type { Redis } from 'ioredis';

/** Env + Redis needed to authenticate every admin sub-router. */
export interface AdminRouterDeps {
  env: Env;
  redis: Redis;
}

/**
 * Build a Router pre-mounted with the admin guard chain — JWT
 * authentication followed by a `super_admin`/`admin` role check. Individual
 * routes can still narrow further with their own `requireRole`.
 * @param deps - Env and Redis for the authenticate middleware.
 * @returns A router with the admin guards already applied.
 */
export function buildAdminRouter(deps: AdminRouterDeps): Router {
  const router = Router();
  router.use(authenticate({ env: deps.env, redis: deps.redis }));
  router.use(requireRole('super_admin', 'admin'));
  return router;
}
