import request from 'supertest';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';

import { Invitation, Tenant, User } from '../../src/models/index.js';

import { integrationDbUp, probeHarness } from './setup.js';

import type { Role } from '@livechat/shared';

type Harness = Awaited<ReturnType<typeof probeHarness>>;

const PASSWORD = 'Invite!Password1';
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Create an active tenant.
 * @param slug - Unique slug.
 * @returns The tenant.
 */
async function createTenant(slug: string): Promise<Tenant> {
  return Tenant.create({
    name: slug,
    slug,
    status: 'active',
    domain: null,
    expiresAt: null,
    settings: null,
  });
}

/**
 * Create an active user with the shared test password.
 * @param email - Unique email.
 * @param role - Role to assign.
 * @param tenantId - Owning tenant, or null for a global user.
 * @returns The user.
 */
async function createUser(email: string, role: Role, tenantId: string | null): Promise<User> {
  return User.create({
    email,
    passwordHash: PASSWORD,
    firstName: 'Test',
    lastName: 'User',
    role,
    tenantId,
    status: 'active',
    emailVerified: true,
    emailVerificationToken: null,
    emailVerificationExpires: null,
    passwordResetToken: null,
    passwordResetExpires: null,
    failedLoginAttempts: 0,
    lockedUntil: null,
    lastLoginAt: null,
    phone: null,
    timezone: null,
    avatarUrl: null,
    preferences: null,
  });
}

/**
 * Create a pending invitation directly.
 * @param email - Invitee email.
 * @param tenantId - Owning tenant, or null.
 * @param invitedBy - Issuer id.
 * @returns The invitation.
 */
async function createInvitation(
  email: string,
  tenantId: string | null,
  invitedBy: string,
): Promise<Invitation> {
  return Invitation.create({
    tenantId,
    email,
    name: null,
    role: 'client',
    token: `tok-${email}`,
    invitedBy,
    expiresAt: new Date(Date.now() + DAY_MS),
    acceptedAt: null,
  });
}

describe.skipIf(!integrationDbUp)('invitations are confined to the caller’s tenant (#196)', () => {
  let harness: Harness = null;
  let ownTenant: Tenant;
  let otherTenant: Tenant;
  let adminToken: string;
  let otherInvite: Invitation;

  /**
   * Log a user in.
   * @param email - The user's email.
   * @returns A bearer access token.
   */
  async function login(email: string): Promise<string> {
    if (harness === null) throw new Error('no harness');
    const res = await request(harness.app)
      .post('/api/v1/auth/login')
      .send({ email, password: PASSWORD });
    expect(res.status).toBe(200);
    return res.body.data.accessToken as string;
  }

  beforeAll(async () => {
    harness = await probeHarness();
    if (harness === null) return;
    ownTenant = await createTenant('invite-own');
    otherTenant = await createTenant('invite-other');
    const admin = await createUser('invite-admin@example.com', 'admin', ownTenant.id);
    const otherAdmin = await createUser('invite-other-admin@example.com', 'admin', otherTenant.id);
    await createInvitation('own-invitee@example.com', ownTenant.id, admin.id);
    otherInvite = await createInvitation(
      'other-invitee@example.com',
      otherTenant.id,
      otherAdmin.id,
    );
    await createInvitation('global-invitee@example.com', null, otherAdmin.id);
    adminToken = await login('invite-admin@example.com');
  }, 60_000);

  afterAll(async () => {
    if (harness !== null) await harness.cleanup();
  });

  describe('list', () => {
    test('shows a tenant admin only their own tenant’s invitations', async () => {
      if (harness === null) return;
      const res = await request(harness.app)
        .get('/api/v1/invitations')
        .set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(200);
      expect(res.body.data).toEqual([
        expect.objectContaining({ email: 'own-invitee@example.com' }),
      ]);
    });

    test('refuses a tenant admin asking for another tenant', async () => {
      if (harness === null) return;
      const res = await request(harness.app)
        .get(`/api/v1/invitations?tenantId=${otherTenant.id}`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(403);
    });
  });

  describe('revoke', () => {
    test('refuses a tenant admin revoking another tenant’s invitation', async () => {
      if (harness === null) return;
      const res = await request(harness.app)
        .post(`/api/v1/invitations/${otherInvite.id}/revoke`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(403);
      await otherInvite.reload();
      expect(otherInvite.status).toBe('pending');
    });
  });

  describe('create', () => {
    /**
     * POST an invitation as the tenant admin.
     * @param body - Request body.
     * @returns The response.
     */
    async function invite(body: Record<string, unknown>): Promise<request.Response> {
      if (harness === null) throw new Error('no harness');
      return request(harness.app)
        .post('/api/v1/invitations')
        .set('Authorization', `Bearer ${adminToken}`)
        .send(body);
    }

    test('refuses a global super_admin invitation from a tenant admin', async () => {
      if (harness === null) return;
      const res = await invite({
        email: 'takeover@example.com',
        role: 'super_admin',
        tenantId: null,
      });
      expect(res.status).toBe(403);
      expect(await Invitation.count({ where: { email: 'takeover@example.com' } })).toBe(0);
    });

    test('refuses a tenant admin inviting into another tenant', async () => {
      if (harness === null) return;
      const res = await invite({
        email: 'cross@example.com',
        role: 'client',
        tenantId: otherTenant.id,
      });
      expect(res.status).toBe(403);
      expect(await Invitation.count({ where: { email: 'cross@example.com' } })).toBe(0);
    });

    test('pins a tenant admin’s invitation to their own tenant when none is given', async () => {
      if (harness === null) return;
      const res = await invite({ email: 'pinned@example.com', role: 'staff' });
      expect(res.status).toBe(201);
      expect(res.body.data.tenantId).toBe(ownTenant.id);
    });

    test('refuses a global invitation from a global admin who is not super_admin', async () => {
      if (harness === null) return;
      await createUser('invite-global-admin@example.com', 'admin', null);
      const token = await login('invite-global-admin@example.com');
      const res = await request(harness.app)
        .post('/api/v1/invitations')
        .set('Authorization', `Bearer ${token}`)
        .send({ email: 'global-staff@example.com', role: 'staff', tenantId: null });
      expect(res.status).toBe(403);
    });

    test('lets a super_admin invite a global super_admin', async () => {
      if (harness === null) return;
      await createUser('invite-super@example.com', 'super_admin', null);
      const token = await login('invite-super@example.com');
      const res = await request(harness.app)
        .post('/api/v1/invitations')
        .set('Authorization', `Bearer ${token}`)
        .send({ email: 'new-super@example.com', role: 'super_admin', tenantId: null });
      expect(res.status).toBe(201);
    });
  });
});
