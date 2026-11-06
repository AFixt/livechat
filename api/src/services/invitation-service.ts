import { randomBytes } from 'node:crypto';

import { Invitation, Tenant } from '../models/index.js';
import { ApiError } from '../utils/api-error.js';

import { assertCanGrantRole, type RoleGrantor } from './role-policy.js';

import type { EmailService } from './email-service.js';
import type { CreateInvitationInput } from '@livechat/shared';

const DAY_MS = 24 * 60 * 60 * 1000;

interface InvitationDeps {
  email: EmailService;
}

/**
 * The tenant an invitation is issued into (#196).
 *
 * A tenant-scoped inviter is pinned to their own tenant: omitting `tenantId`
 * means their tenant, and naming another one is a 403 rather than a silent
 * override. A global invitation (no tenant) can only come from a super_admin.
 * @param requested - The `tenantId` from the request, if any.
 * @param inviter - The issuer.
 * @returns The tenant id, or null for a global invitation.
 * @throws {ApiError} 403 when the inviter may not invite there.
 */
function invitationTenant(
  requested: string | null | undefined,
  inviter: RoleGrantor,
): string | null {
  if (inviter.tenantId !== null) {
    if (requested !== undefined && requested !== inviter.tenantId) {
      throw ApiError.forbidden('Access denied to this tenant');
    }
    return inviter.tenantId;
  }
  const tenantId = requested ?? null;
  if (tenantId === null && inviter.role !== 'super_admin') {
    throw ApiError.forbidden('Only a super_admin can issue a global invitation');
  }
  return tenantId;
}

/**
 * Build the invitation service.
 * @param deps - Email service dependency.
 * @returns Invitation management methods.
 */
export function createInvitationService(deps: InvitationDeps) {
  return {
    /**
     * Issue an invitation and email the recipient with a registration URL.
     *
     * The invitation's tenant and role are checked against the inviter
     * (#196): a tenant-scoped inviter can only invite into their own tenant,
     * a global invitation needs a super_admin, and the role passes the same
     * ceiling as a role change.
     * @param input - Validated invitation input.
     * @param inviter - The issuer.
     * @returns The newly-created invitation.
     * @throws {ApiError} 403 when the invitation exceeds the inviter's authority.
     */
    async create(input: CreateInvitationInput, inviter: RoleGrantor): Promise<Invitation> {
      const tenantId = invitationTenant(input.tenantId, inviter);
      assertCanGrantRole(inviter, input.role, tenantId);
      if (tenantId !== null) {
        const tenant = await Tenant.findByPk(tenantId);
        if (tenant === null) throw ApiError.badRequest('Tenant not found');
      }
      const token = randomBytes(32).toString('hex');
      const invitation = await Invitation.create({
        tenantId,
        email: input.email,
        name: input.name ?? null,
        role: input.role,
        token,
        invitedBy: inviter.id,
        expiresAt: new Date(Date.now() + input.expiresInDays * DAY_MS),
      });
      await deps.email.sendInvitationEmail(invitation);
      return invitation;
    },

    /**
     * List invitations, optionally filtered by tenant.
     * @param tenantId - If provided, restrict to a tenant.
     * @returns Invitations ordered by created_at desc.
     */
    async list(tenantId?: string): Promise<Invitation[]> {
      return Invitation.findAll({
        where: tenantId === undefined ? {} : { tenantId },
        order: [['createdAt', 'DESC']],
      });
    },

    /**
     * Revoke a pending invitation.
     * @param id - Invitation UUID.
     * @param scope - The caller's tenant, or undefined when unrestricted.
     * @throws {ApiError} 403 when the invitation belongs to another tenant.
     */
    async revoke(id: string, scope: string | undefined): Promise<void> {
      const invitation = await Invitation.findByPk(id);
      if (invitation === null) throw ApiError.notFound('Invitation not found');
      if (scope !== undefined && invitation.tenantId !== scope) {
        throw ApiError.forbidden('Access denied to this tenant');
      }
      if (invitation.status !== 'pending') {
        throw ApiError.badRequest(`Cannot revoke a ${invitation.status} invitation`);
      }
      await invitation.update({ status: 'revoked' });
    },
  };
}

/**
 * Shape of the invitation service.
 */
export type InvitationService = ReturnType<typeof createInvitationService>;
