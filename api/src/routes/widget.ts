import { Router } from 'express';

import { Tenant } from '../models/index.js';
import { ApiError } from '../utils/api-error.js';
import { asyncHandler } from '../utils/async-handler.js';

/**
 * Build the `/widget` sub-router. Public, cookieless — the widget script
 * fetches this before initializing a visitor session.
 * @returns Express router.
 */
export function buildWidgetRouter(): Router {
  const router = Router();

  router.get(
    '/config',
    asyncHandler(async (req, res) => {
      const tenantKey = req.query.tenantKey;
      if (typeof tenantKey !== 'string' || tenantKey.length === 0) {
        throw ApiError.badRequest('tenantKey is required');
      }
      const tenant = await Tenant.findOne({
        where: { slug: tenantKey, status: 'active' },
        attributes: ['id', 'slug', 'name', 'settings', 'allowedOrigins'],
      });
      if (tenant === null) throw ApiError.notFound('Unknown tenant');

      const settings = tenant.settings ?? {};
      res.set('Cache-Control', 'public, max-age=60');
      res.json({
        success: true,
        data: {
          tenantId: tenant.id,
          tenantKey: tenant.slug,
          name: tenant.name,
          primaryColor: settings.primaryColor ?? null,
          supportHoursText: settings.supportHoursText ?? null,
          supportPhone: settings.supportPhone ?? null,
          allowedOrigins: tenant.allowedOrigins ?? [],
        },
      });
    }),
  );

  router.post(
    '/csp-report',
    asyncHandler(async (_req, res) => {
      // Browsers POST violation reports here with Content-Type:
      // application/csp-report. Body parsing is handled by express.json
      // below; we just acknowledge and rely on pino-http to log the body.
      res.status(204).end();
      await Promise.resolve();
    }),
  );

  return router;
}
