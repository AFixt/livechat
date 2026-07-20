import { Router } from 'express';

import { originAllowed } from '../middlewares/origin-allowed.js';

import { buildAuthRouter } from './auth.js';
import { buildChatsRouter } from './chats.js';
import healthRouter from './health.js';
import { buildInvitationsRouter } from './invitations.js';
import { buildTenantsRouter } from './tenants.js';
import { buildUsersRouter } from './users.js';
import { buildVisitorRouter } from './visitor.js';
import { buildWidgetRouter } from './widget.js';

import type { Env } from '../config/env.js';
import type { Services } from '../services/index.js';
import type { Redis } from 'ioredis';

interface RouterDeps {
  env: Env;
  redis: Redis;
  services: Services;
  /** Skip all rate limiters (for unit tests). */
  skipRateLimit?: boolean;
}

/**
 * Build the top-level `/api/v1` router with all sub-routes mounted.
 * @param deps - Env, redis, services, and flags.
 * @returns Express router.
 */
export function buildRouter(deps: RouterDeps): Router {
  const router = Router();
  router.use('/health', healthRouter);
  router.use(
    '/auth',
    buildAuthRouter({
      env: deps.env,
      redis: deps.redis,
      auth: deps.services.auth,
      ...(deps.skipRateLimit === true && { skipRateLimit: true }),
    }),
  );
  router.use(
    '/tenants',
    buildTenantsRouter({ env: deps.env, redis: deps.redis, tenant: deps.services.tenant }),
  );
  router.use(
    '/users',
    buildUsersRouter({ env: deps.env, redis: deps.redis, user: deps.services.user }),
  );
  router.use(
    '/invitations',
    buildInvitationsRouter({
      env: deps.env,
      redis: deps.redis,
      invitation: deps.services.invitation,
    }),
  );
  router.use('/widget', originAllowed(), buildWidgetRouter());
  router.use(
    '/visitor',
    originAllowed(),
    buildVisitorRouter({
      env: deps.env,
      visitorSession: deps.services.visitorSession,
      chat: deps.services.chat,
    }),
  );
  router.use(
    '/chats',
    buildChatsRouter({
      env: deps.env,
      redis: deps.redis,
      chat: deps.services.chat,
    }),
  );
  return router;
}
