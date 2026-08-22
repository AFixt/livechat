import { Router } from 'express';

import { originAllowed } from '../middlewares/origin-allowed.js';

import { buildAuthRouter } from './auth.js';
import { buildChatsRouter } from './chats.js';
import { buildHealthRouter } from './health.js';
import { buildInvitationsRouter } from './invitations.js';
import { buildPrivacyRouter } from './privacy.js';
import { buildTenantsRouter } from './tenants.js';
import { buildUsersRouter } from './users.js';
import { buildVisitorSessionsRouter } from './visitor-sessions.js';
import { buildVisitorRouter } from './visitor.js';
import { buildWidgetRouter } from './widget.js';

import type { Env } from '../config/env.js';
import type { AdapterHealth } from '../io/adapter.js';
import type { IoRef } from '../io/io-ref.js';
import type { Services } from '../services/index.js';
import type { Redis } from 'ioredis';

interface RouterDeps {
  env: Env;
  redis: Redis;
  services: Services;
  /** Socket.IO Redis adapter health, surfaced by `/health` (#73). */
  socketAdapterHealth?: AdapterHealth;
  /** Late-bound Socket.IO server, for disconnecting a revoked visitor (#123). */
  ioRef?: IoRef;
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
  router.use(
    '/health',
    buildHealthRouter(
      deps.socketAdapterHealth ? { socketAdapterHealth: deps.socketAdapterHealth } : {},
    ),
  );
  router.use(
    '/auth',
    buildAuthRouter({
      env: deps.env,
      redis: deps.redis,
      auth: deps.services.auth,
      audit: deps.services.audit,
      ...(deps.skipRateLimit === true && { skipRateLimit: true }),
    }),
  );
  router.use(
    '/tenants',
    buildTenantsRouter({
      env: deps.env,
      redis: deps.redis,
      tenant: deps.services.tenant,
      audit: deps.services.audit,
    }),
  );
  router.use(
    '/users',
    buildUsersRouter({
      env: deps.env,
      redis: deps.redis,
      user: deps.services.user,
      audit: deps.services.audit,
    }),
  );
  router.use(
    '/invitations',
    buildInvitationsRouter({
      env: deps.env,
      redis: deps.redis,
      invitation: deps.services.invitation,
    }),
  );
  router.use(
    '/widget',
    originAllowed(),
    buildWidgetRouter({
      presence: deps.services.presence,
      redis: deps.redis,
      ...(deps.skipRateLimit === true && { skipRateLimit: true }),
    }),
  );
  router.use(
    '/privacy',
    originAllowed(),
    buildPrivacyRouter({
      env: deps.env,
      consent: deps.services.consent,
      visitorSession: deps.services.visitorSession,
    }),
  );
  router.use(
    '/visitor',
    originAllowed(),
    buildVisitorRouter({
      env: deps.env,
      visitorSession: deps.services.visitorSession,
      consent: deps.services.consent,
      chat: deps.services.chat,
      presence: deps.services.presence,
      email: deps.services.email,
    }),
  );
  router.use(
    '/visitor-sessions',
    buildVisitorSessionsRouter({
      env: deps.env,
      redis: deps.redis,
      visitorSession: deps.services.visitorSession,
      presence: deps.services.presence,
      audit: deps.services.audit,
      ...(deps.ioRef && { ioRef: deps.ioRef }),
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
