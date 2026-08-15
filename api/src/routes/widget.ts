import { Router } from 'express';

import { Tenant } from '../models/index.js';
import { parseSupportHours } from '../services/support-hours.js';
import { ApiError } from '../utils/api-error.js';
import { asyncHandler } from '../utils/async-handler.js';

import type { PresenceService } from '../services/index.js';

interface WidgetRouterDeps {
  presence: PresenceService;
}

/**
 * Resolve the support-hours display string: prefer the structured schedule's
 * own `text`, then a legacy free-text `supportHoursText` setting.
 * @param settings - The tenant's settings blob.
 * @param supportHours - The parsed schedule (or null).
 * @returns The display string, or null when neither is configured.
 */
function resolveSupportHoursText(
  settings: Record<string, unknown>,
  supportHours: ReturnType<typeof parseSupportHours>,
): string | null {
  if (supportHours?.text !== undefined) return supportHours.text;
  return typeof settings.supportHoursText === 'string' ? settings.supportHoursText : null;
}

/**
 * Assemble the public widget-config payload for a tenant.
 * @param tenant - The resolved active tenant.
 * @param supportAvailable - Whether support is currently available.
 * @returns The response `data` object.
 */
function toWidgetConfig(tenant: Tenant, supportAvailable: boolean): Record<string, unknown> {
  const settings = tenant.settings ?? {};
  return {
    tenantId: tenant.id,
    tenantKey: tenant.slug,
    name: tenant.name,
    primaryColor: settings.primaryColor ?? null,
    supportHoursText: resolveSupportHoursText(settings, parseSupportHours(settings.supportHours)),
    supportPhone: settings.supportPhone ?? null,
    supportAvailable,
    allowedOrigins: tenant.allowedOrigins ?? [],
  };
}

/**
 * Build the `/widget` sub-router. Public, cookieless — the widget script
 * fetches this before initializing a visitor session.
 * @param deps - Presence service (for the initial support-availability flag).
 * @returns Express router.
 */
export function buildWidgetRouter(deps: WidgetRouterDeps): Router {
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

      const supportHours = parseSupportHours(tenant.settings?.supportHours);
      const supportAvailable = await deps.presence.anyStaffAvailable(tenant.id, { supportHours });
      res.set('Cache-Control', 'no-store');
      res.json({ success: true, data: toWidgetConfig(tenant, supportAvailable) });
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
