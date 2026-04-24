import { Tenant } from '../models/index.js';
import { ApiError } from '../utils/api-error.js';

import type { RequestHandler } from 'express';

/**
 * Resolve the tenant slug from a request. Accepts `?tenantKey=...` in the
 * query string or `body.tenantKey` — both forms are used by the widget
 * during init. Falls through to `undefined` when neither is set (let the
 * downstream validator produce the real 400).
 */
function resolveTenantKey(req: Parameters<RequestHandler>[0]): string | undefined {
  const fromQuery = req.query.tenantKey;
  if (typeof fromQuery === 'string') return fromQuery;
  const body = req.body as { tenantKey?: unknown } | undefined;
  if (body !== undefined && typeof body.tenantKey === 'string') return body.tenantKey;
  return undefined;
}

/**
 * Enforce the tenant's `allowed_origins` list for a cross-origin request.
 * No-op when:
 *   - The tenant has no allowedOrigins set (or an empty array), treated as
 *     "no restriction" during development.
 *   - The request has no `Origin` header (same-origin navigations and
 *     curl / server-to-server calls).
 *   - The tenant can't be resolved from the request (a later 400 handles it).
 * @returns Express middleware that 403s on an origin mismatch.
 */
export function originAllowed(): RequestHandler {
  return (req, _res, next) => {
    (async () => {
      const origin = req.header('origin');
      if (origin === undefined) {
        next();
        return;
      }
      const tenantKey = resolveTenantKey(req);
      if (tenantKey === undefined) {
        next();
        return;
      }
      const tenant = await Tenant.findOne({
        where: { slug: tenantKey },
        attributes: ['id', 'allowedOrigins'],
      });
      if (tenant === null) {
        next();
        return;
      }
      const allowed = tenant.allowedOrigins ?? [];
      if (allowed.length === 0) {
        next();
        return;
      }
      if (!allowed.includes(origin)) {
        next(ApiError.forbidden('Origin not allowed for this tenant'));
        return;
      }
      next();
    })().catch(next);
  };
}
