import {
  createTenantInputSchema,
  updateTenantInputSchema,
  type CreateTenantInput,
  type UpdateTenantInput,
} from '@livechat/shared';

import { assertTenantAccess, callerTenantScope, requireRole } from '../middlewares/authorize.js';
import { parsedBody, validate } from '../middlewares/validate.js';
import { asyncHandler } from '../utils/async-handler.js';
import { recordAudit } from '../utils/audit.js';

import { buildAdminRouter } from './admin-router.js';

import type { AdminRouterDeps } from './admin-router.js';
import type { AuditService, TenantService } from '../services/index.js';
import type { Router } from 'express';

interface TenantsRouterDeps extends AdminRouterDeps {
  tenant: TenantService;
  audit: AuditService;
}

/**
 * Build the `/tenants` sub-router (super_admin + admin).
 * @param deps - Env, redis, tenant service.
 * @returns Express router.
 */
export function buildTenantsRouter(deps: TenantsRouterDeps): Router {
  const router = buildAdminRouter(deps);

  router.get(
    '/',
    asyncHandler(async (req, res) => {
      const tenants = await deps.tenant.list();
      // A tenant-scoped admin sees only their own tenant in the list.
      const scope = callerTenantScope(req);
      const visible = scope === undefined ? tenants : tenants.filter((t) => t.id === scope);
      res.json({ success: true, data: visible });
    }),
  );

  router.post(
    '/',
    requireRole('super_admin'),
    validate({ body: createTenantInputSchema }),
    asyncHandler(async (req, res) => {
      const body = parsedBody(req, createTenantInputSchema) satisfies CreateTenantInput;
      const tenant = await deps.tenant.create(body);
      await recordAudit(deps.audit, req, {
        action: 'tenant.create',
        resourceType: 'tenant',
        resourceId: tenant.id,
        metadata: { slug: tenant.slug },
      });
      res.status(201).json({ success: true, data: tenant });
    }),
  );

  router.get(
    '/:id',
    asyncHandler(async (req, res) => {
      const id = req.params.id;
      if (typeof id !== 'string') return;
      const tenant = await deps.tenant.getById(id);
      assertTenantAccess(req, tenant.id);
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
      await recordAudit(deps.audit, req, {
        action: 'tenant.update',
        resourceType: 'tenant',
        resourceId: tenant.id,
        metadata: { fields: Object.keys(body) },
      });
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
      await recordAudit(deps.audit, req, {
        action: 'tenant.delete',
        resourceType: 'tenant',
        resourceId: id,
      });
      res.json({ success: true });
    }),
  );

  router.post(
    '/:id/rotate-embed-secret',
    requireRole('super_admin'),
    asyncHandler(async (req, res) => {
      const id = req.params.id;
      if (typeof id !== 'string') return;
      const secret = await deps.tenant.rotateEmbedSecret(id);
      // Never record the secret itself.
      await recordAudit(deps.audit, req, {
        action: 'tenant.rotate_embed_secret',
        resourceType: 'tenant',
        resourceId: id,
      });
      res.json({ success: true, data: { embedSecret: secret } });
    }),
  );

  router.put(
    '/:id/allowed-origins',
    requireRole('super_admin'),
    asyncHandler(async (req, res) => {
      const id = req.params.id;
      if (typeof id !== 'string') return;
      const body = req.body as { origins?: unknown } | undefined;
      const origins = Array.isArray(body?.origins)
        ? (body.origins as string[]).filter((s) => typeof s === 'string')
        : null;
      const tenant = await deps.tenant.setAllowedOrigins(id, origins);
      res.json({ success: true, data: tenant });
    }),
  );

  return router;
}
