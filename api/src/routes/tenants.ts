import {
  createTenantInputSchema,
  updateTenantInputSchema,
  type CreateTenantInput,
  type UpdateTenantInput,
} from '@livechat/shared';
import { Router } from 'express';

import { authenticate } from '../middlewares/authenticate.js';
import { requireRole } from '../middlewares/authorize.js';
import { parsedBody, validate } from '../middlewares/validate.js';
import { asyncHandler } from '../utils/async-handler.js';

import type { Env } from '../config/env.js';
import type { TenantService } from '../services/index.js';
import type { Redis } from 'ioredis';

interface TenantsRouterDeps {
  env: Env;
  redis: Redis;
  tenant: TenantService;
}

/**
 * Build the `/tenants` sub-router (super_admin + admin).
 * @param deps - Env, redis, tenant service.
 * @returns Express router.
 */
export function buildTenantsRouter(deps: TenantsRouterDeps): Router {
  const router = Router();
  router.use(authenticate({ env: deps.env, redis: deps.redis }));
  router.use(requireRole('super_admin', 'admin'));

  router.get(
    '/',
    asyncHandler(async (_req, res) => {
      const tenants = await deps.tenant.list();
      res.json({ success: true, data: tenants });
    }),
  );

  router.post(
    '/',
    requireRole('super_admin'),
    validate({ body: createTenantInputSchema }),
    asyncHandler(async (req, res) => {
      const body = parsedBody(req, createTenantInputSchema) satisfies CreateTenantInput;
      const tenant = await deps.tenant.create(body);
      res.status(201).json({ success: true, data: tenant });
    }),
  );

  router.get(
    '/:id',
    asyncHandler(async (req, res) => {
      const id = req.params.id;
      if (typeof id !== 'string') return;
      const tenant = await deps.tenant.getById(id);
      res.json({ success: true, data: tenant });
    }),
  );

  router.patch(
    '/:id',
    requireRole('super_admin'),
    validate({ body: updateTenantInputSchema }),
    asyncHandler(async (req, res) => {
      const id = req.params.id;
      if (typeof id !== 'string') return;
      const body = parsedBody(req, updateTenantInputSchema) satisfies UpdateTenantInput;
      const tenant = await deps.tenant.update(id, body);
      res.json({ success: true, data: tenant });
    }),
  );

  router.delete(
    '/:id',
    requireRole('super_admin'),
    asyncHandler(async (req, res) => {
      const id = req.params.id;
      if (typeof id !== 'string') return;
      await deps.tenant.remove(id);
      res.json({ success: true });
    }),
  );

  return router;
}
