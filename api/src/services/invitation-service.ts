import { randomBytes } from 'node:crypto';

import { Invitation, Tenant } from '../models/index.js';
import { ApiError } from '../utils/api-error.js';

import type { CreateInvitationInput } from '@livechat/shared';
import type { EmailService } from './email-service.js';

const DAY_MS = 24 * 60 * 60 * 1000;

interface InvitationDeps {
  email: EmailService;
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
     * @param input - Validated invitation input.
     * @param invitedBy - User id of the issuer.
     * @returns The newly-created invitation.
     */
    async create(input: CreateInvitationInput, invitedBy: string): Promise<Invitation> {
      if (input.tenantId !== undefined && input.tenantId !== null) {
        const tenant = await Tenant.findByPk(input.tenantId);
        if (tenant === null) throw ApiError.badRequest('Tenant not found');
      }
      const token = randomBytes(32).toString('hex');
      const invitation = await Invitation.create({
        tenantId: input.tenantId ?? null,
        email: input.email,
        name: input.name ?? null,
        role: input.role,
        token,
        invitedBy,
        expiresAt: new Date(Date.now() + input.expiresInDays * DAY_MS),
      });
      await deps.email.sendInvitationEmail(input.email, input.name ?? null, token);
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
     */
    async revoke(id: string): Promise<void> {
      const invitation = await Invitation.findByPk(id);
      if (invitation === null) throw ApiError.notFound('Invitation not found');
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
