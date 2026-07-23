import { ApiError } from '../utils/api-error.js';

import type { Role } from '@livechat/shared';
import type { Request, RequestHandler } from 'express';

/**
 * Require the authenticated user to hold one of the listed roles.
 * @param roles - Allowed roles.
 * @returns Express middleware.
 */
export function requireRole(...roles: Role[]): RequestHandler {
  return (req, _res, next) => {
    if (req.user === undefined) {
      next(ApiError.unauthorized());
      return;
    }
    if (!roles.includes(req.user.role)) {
      next(ApiError.forbidden('Insufficient permissions'));
      return;
    }
    next();
  };
}

/**
 * Shorthand: require super_admin, admin, or staff.
 * @returns Express middleware.
 */
export function requireStaffOrAdmin(): RequestHandler {
  return requireRole('super_admin', 'admin', 'staff');
}

/**
 * The tenant a caller is confined to, or `undefined` when unrestricted.
 *
 * Mirrors the identity model: AFixt staff carry no tenant of their own
 * (`tenant_id` is null) and serve every tenant, matching how untenanted staff
 * watch all tenants over Socket.IO. Anyone carrying a `tenant_id` — a
 * tenant-scoped admin, staff member, or client — is confined to it.
 * @param req - The authenticated request.
 * @returns The tenant id the caller is limited to, or undefined for none.
 */
export function callerTenantScope(req: Request): string | undefined {
  return req.user?.tenantId ?? undefined;
}

/**
 * Reject the request unless the caller may act on `tenantId`.
 *
 * Resource-level rather than request-level on purpose: for routes addressed by
 * resource id (`/chats/:id`, `/users/:id`) the owning tenant is a property of
 * the fetched row, so it cannot be checked from params/body/query before the
 * lookup happens.
 * @param req - The authenticated request.
 * @param tenantId - The owning tenant of the resource being touched.
 * @throws {ApiError} 403 when the caller is scoped to a different tenant.
 */
export function assertTenantAccess(req: Request, tenantId: string | null): void {
  const scope = callerTenantScope(req);
  if (scope === undefined) return;
  if (tenantId !== scope) {
    throw ApiError.forbidden('Access denied to this tenant');
  }
}

/**
 * Resolve the tenant filter for a collection endpoint.
 *
 * A scoped caller is pinned to their own tenant regardless of what they ask
 * for, so omitting `?tenantId` can never widen the result set across tenants.
 * Explicitly requesting a different tenant is a 403 rather than a silent
 * override, so the caller is told rather than quietly given the wrong answer.
 * @param req - The authenticated request.
 * @param requested - The caller-supplied tenant filter, if any.
 * @returns The tenant id to filter by, or undefined for all tenants.
 * @throws {ApiError} 403 when a scoped caller requests another tenant.
 */
export function resolveTenantFilter(req: Request, requested: unknown): string | undefined {
  const asked = typeof requested === 'string' ? requested : undefined;
  const scope = callerTenantScope(req);
  if (scope === undefined) return asked;
  if (asked !== undefined && asked !== scope) {
    throw ApiError.forbidden('Access denied to this tenant');
  }
  return scope;
}
