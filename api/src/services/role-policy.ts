import { ApiError } from '../utils/api-error.js';

import type { Role } from '@livechat/shared';

/** The caller fields the role ceiling reads. */
export interface RoleGrantor {
  /** The caller's user id. */
  id: string;
  /** The caller's own role. */
  role: Role;
  /** The caller's tenant, or null for an untenanted (global) caller. */
  tenantId: string | null;
}

/** Privilege order: a caller may grant a role only at or below their own. */
const ROLE_RANK: Readonly<Record<Role, number>> = {
  client: 0,
  staff: 1,
  admin: 2,
  super_admin: 3,
};

/**
 * Roles a user may hold while carrying a `tenant_id`. `super_admin` passes
 * every tenant check, so it is global by definition and never tenanted.
 */
const TENANT_ROLES: readonly Role[] = ['admin', 'staff', 'client'];

/**
 * Reject granting `role` to a recipient in `tenantId` beyond the caller's
 * authority (#195).
 *
 * The one role ceiling every path that sets a role goes through, so user
 * updates and invitations cannot drift apart:
 * - nobody grants a role above their own, so only `super_admin` grants
 *   `super_admin`;
 * - a role granted inside a tenant must be one a tenant user may hold.
 * @param grantor - The caller granting the role.
 * @param role - The role being granted.
 * @param tenantId - The recipient's tenant, or null for a global user.
 * @throws {ApiError} 403 when the grant exceeds the caller's authority.
 */
export function assertCanGrantRole(
  grantor: RoleGrantor,
  role: Role,
  tenantId: string | null,
): void {
  if (ROLE_RANK[role] > ROLE_RANK[grantor.role]) {
    throw ApiError.forbidden('You cannot grant a role above your own');
  }
  if (tenantId !== null && !TENANT_ROLES.includes(role)) {
    throw ApiError.forbidden(`A tenant user cannot hold the ${role} role`);
  }
}

/**
 * Reject changing a user's role from `from` to `to` beyond the caller's
 * authority (#195): never your own role, never a user who outranks you, and
 * never to a role {@link assertCanGrantRole} refuses.
 * @param grantor - The caller making the change.
 * @param target - The user whose role changes.
 * @param target.id - Their user id.
 * @param target.role - Their current role.
 * @param target.tenantId - Their tenant, or null.
 * @param to - The requested role.
 * @throws {ApiError} 403 when the change exceeds the caller's authority.
 */
export function assertCanChangeRole(
  grantor: RoleGrantor,
  target: { id: string; role: Role; tenantId: string | null },
  to: Role,
): void {
  if (to === target.role) return;
  if (grantor.id === target.id) throw ApiError.forbidden('You cannot change your own role');
  if (ROLE_RANK[target.role] > ROLE_RANK[grantor.role]) {
    throw ApiError.forbidden('You cannot change the role of a user who outranks you');
  }
  assertCanGrantRole(grantor, to, target.tenantId);
}
