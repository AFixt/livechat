import { ApiError } from '../utils/api-error.js';

import type { Role } from '@livechat/shared';
import type { RequestHandler } from 'express';

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
 * Restrict access to a resource by tenant: super_admin/admin/staff may touch
 * any tenant; clients may only touch their own.
 * @returns Express middleware that reads a tenantId from params/body/query.
 */
export function requireTenantAccess(): RequestHandler {
  return (req, _res, next) => {
    if (req.user === undefined) {
      next(ApiError.unauthorized());
      return;
    }
    if (['super_admin', 'admin', 'staff'].includes(req.user.role)) {
      next();
      return;
    }
    const tenantId =
      (req.params.tenantId as string | undefined) ??
      ((req.body as Record<string, unknown>).tenantId as string | undefined) ??
      (req.query.tenantId as string | undefined);
    if (tenantId !== undefined && req.user.tenantId !== tenantId) {
      next(ApiError.forbidden('Access denied to this tenant'));
      return;
    }
    next();
  };
}
