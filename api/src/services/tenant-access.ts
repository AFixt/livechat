import { Tenant } from '../models/index.js';
import { ApiError } from '../utils/api-error.js';

import type { Role } from '@livechat/shared';

/** The user fields the tenant rule reads. */
export interface TenantScopedUser {
  /** The user's role; `super_admin` is never tenant-gated. */
  role: Role;
  /** The user's tenant, or null for an untenanted (global) user. */
  tenantId: string | null;
}

/**
 * Reject a user whose tenant no longer permits access (#197).
 *
 * One check shared by every path a tenant user reaches the system through:
 * login, token refresh, every authenticated API request and the `/staff`
 * Socket.IO handshake. Before this only the request path looked at the
 * tenant, and only at `expiresAt` — `status` was loaded but never read, so a
 * suspended or archived tenant with no expiry kept full access. Ported from
 * AFixt/help-desk#299 so the two products apply the same rule.
 *
 * A tenant is usable only when it exists, is `active`, and has not passed
 * `expiresAt`. A missing row (soft-deleted, since the model is paranoid) is
 * refused rather than waved through: failing open on a deleted tenant would
 * grant more access than suspending it does.
 *
 * Untenanted users and super admins are not tenant-scoped and are unaffected.
 * @param user - The user whose tenant is checked.
 * @throws {ApiError} 403 when the tenant is inactive, missing or expired.
 */
export async function assertTenantUsable(user: TenantScopedUser): Promise<void> {
  if (user.tenantId === null || user.role === 'super_admin') return;
  const tenant = await Tenant.findByPk(user.tenantId, {
    attributes: ['id', 'expiresAt', 'status'],
  });
  if (tenant?.status !== 'active') {
    throw ApiError.forbidden(
      "Your organization's access is not active. Please contact your administrator.",
    );
  }
  if (tenant.expiresAt !== null && new Date() > new Date(tenant.expiresAt)) {
    throw ApiError.forbidden(
      "Your organization's access has expired. Please contact your administrator.",
    );
  }
}
