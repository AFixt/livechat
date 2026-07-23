import { afterEach, describe, expect, it, vi } from 'vitest';

import { Invitation, Tenant } from '../models/index.js';
import { ApiError } from '../utils/api-error.js';

import { createInvitationService } from './invitation-service.js';

import type { EmailService } from './email-service.js';
import type { CreateInvitationInput } from '@livechat/shared';

function fakeEmail(): EmailService {
  return {
    sendInvitationEmail: vi.fn().mockResolvedValue(undefined),
  } as unknown as EmailService;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('invitation-service', () => {
  describe('create', () => {
    it('creates a tenant-scoped invitation and emails the recipient', async () => {
      vi.spyOn(Tenant, 'findByPk').mockResolvedValue({ id: 'tenant-1' } as Tenant);
      const created = { id: 'inv-1' } as Invitation;
      const createSpy = vi.spyOn(Invitation, 'create').mockResolvedValue(created);
      const email = fakeEmail();
      const service = createInvitationService({ email });

      const input: CreateInvitationInput = {
        tenantId: 'tenant-1',
        email: 'new@example.com',
        name: 'New Person',
        role: 'staff',
        expiresInDays: 7,
      };
      const result = await service.create(input, 'inviter-1');

      expect(result).toBe(created);
      expect(createSpy).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({
          tenantId: 'tenant-1',
          email: 'new@example.com',
          name: 'New Person',
          role: 'staff',
          invitedBy: 'inviter-1',
        }),
      );
      expect(email.sendInvitationEmail).toHaveBeenCalledExactlyOnceWith(
        'new@example.com',
        'New Person',
        expect.any(String),
      );
    });

    it('creates an untenanted invitation without checking the tenant', async () => {
      const findByPk = vi.spyOn(Tenant, 'findByPk');
      const created = { id: 'inv-2' } as Invitation;
      vi.spyOn(Invitation, 'create').mockResolvedValue(created);
      const email = fakeEmail();
      const service = createInvitationService({ email });

      const input: CreateInvitationInput = {
        tenantId: null,
        email: 'global@example.com',
        role: 'staff',
        expiresInDays: 3,
      };
      const result = await service.create(input, 'inviter-1');

      expect(result).toBe(created);
      expect(findByPk).not.toHaveBeenCalled();
      expect(email.sendInvitationEmail).toHaveBeenCalledExactlyOnceWith(
        'global@example.com',
        null,
        expect.any(String),
      );
    });

    it('throws 400 when the given tenantId does not exist', async () => {
      vi.spyOn(Tenant, 'findByPk').mockResolvedValue(null);
      const createSpy = vi.spyOn(Invitation, 'create');
      const email = fakeEmail();
      const service = createInvitationService({ email });

      const input: CreateInvitationInput = {
        tenantId: 'ghost-tenant',
        email: 'x@example.com',
        role: 'staff',
        expiresInDays: 7,
      };

      await expect(service.create(input, 'inviter-1')).rejects.toMatchObject({
        status: 400,
        message: 'Tenant not found',
      });
      expect(createSpy).not.toHaveBeenCalled();
      expect(email.sendInvitationEmail).not.toHaveBeenCalled();
    });
  });

  describe('list', () => {
    it('lists all invitations when no tenant filter is given', async () => {
      const findAll = vi.spyOn(Invitation, 'findAll').mockResolvedValue([]);
      const service = createInvitationService({ email: fakeEmail() });

      await service.list();

      expect(findAll).toHaveBeenCalledExactlyOnceWith({
        where: {},
        order: [['createdAt', 'DESC']],
      });
    });

    it('filters by tenant when a tenantId is given', async () => {
      const findAll = vi.spyOn(Invitation, 'findAll').mockResolvedValue([]);
      const service = createInvitationService({ email: fakeEmail() });

      await service.list('tenant-9');

      expect(findAll).toHaveBeenCalledExactlyOnceWith({
        where: { tenantId: 'tenant-9' },
        order: [['createdAt', 'DESC']],
      });
    });
  });

  describe('revoke', () => {
    it('revokes a pending invitation', async () => {
      const update = vi.fn().mockResolvedValue(undefined);
      vi.spyOn(Invitation, 'findByPk').mockResolvedValue({
        status: 'pending',
        update,
      } as unknown as Invitation);
      const service = createInvitationService({ email: fakeEmail() });

      await service.revoke('inv-1');

      expect(update).toHaveBeenCalledExactlyOnceWith({ status: 'revoked' });
    });

    it('throws 404 when the invitation does not exist', async () => {
      vi.spyOn(Invitation, 'findByPk').mockResolvedValue(null);
      const service = createInvitationService({ email: fakeEmail() });

      await expect(service.revoke('missing')).rejects.toMatchObject({
        status: 404,
        message: 'Invitation not found',
      });
    });

    it('throws 400 when the invitation is not pending', async () => {
      const update = vi.fn();
      vi.spyOn(Invitation, 'findByPk').mockResolvedValue({
        status: 'accepted',
        update,
      } as unknown as Invitation);
      const service = createInvitationService({ email: fakeEmail() });

      await expect(service.revoke('inv-2')).rejects.toBeInstanceOf(ApiError);
      await expect(service.revoke('inv-2')).rejects.toMatchObject({
        status: 400,
        message: 'Cannot revoke a accepted invitation',
      });
      expect(update).not.toHaveBeenCalled();
    });
  });
});
