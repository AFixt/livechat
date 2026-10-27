import request from 'supertest';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';

import { AuditLog, Tenant, User } from '../../src/models/index.js';

import { integrationDbUp, probeHarness } from './setup.js';

import type { Role } from '@livechat/shared';

type Harness = Awaited<ReturnType<typeof probeHarness>>;

const PASSWORD = 'Role!Password1';

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

describe.skipIf(!integrationDbUp)('role changes respect the caller’s ceiling (#195)', () => {
  let harness: Harness = null;
  let tenantAdmin: User;
  let tenantAdminToken: string;
  let tenantStaff: User;

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

  /**
   * PATCH a user's role.
   * @param token - Caller's access token.
   * @param userId - Target user.
   * @param role - Requested role.
   * @returns The response.
   */
  async function patchRole(token: string, userId: string, role: Role): Promise<request.Response> {
    if (harness === null) throw new Error('no harness');
    return request(harness.app)
      .patch(`/api/v1/users/${userId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ role });
  }

  /**
   * The denied-update audit rows recorded against a user.
   * @param userId - The target user.
   * @returns Matching rows.
   */
  async function deniedAudits(userId: string): Promise<AuditLog[]> {
    return AuditLog.findAll({ where: { action: 'user.update_denied', resourceId: userId } });
  }

  beforeAll(async () => {
    harness = await probeHarness();
    if (harness === null) return;
    const tenant = await createTenant('role-ceiling');
    tenantAdmin = await createUser('role-admin@example.com', 'admin', tenant.id);
    tenantStaff = await createUser('role-staff@example.com', 'staff', tenant.id);
    tenantAdminToken = await login('role-admin@example.com');
  }, 60_000);

  afterAll(async () => {
    if (harness !== null) await harness.cleanup();
  });

  test('a tenant admin cannot promote another user to super_admin', async () => {
    if (harness === null) return;
    const res = await patchRole(tenantAdminToken, tenantStaff.id, 'super_admin');
    expect(res.status).toBe(403);
    await tenantStaff.reload();
    expect(tenantStaff.role).toBe('staff');
    expect(await deniedAudits(tenantStaff.id)).toHaveLength(1);
  });

  test('a tenant admin cannot promote themselves to super_admin', async () => {
    if (harness === null) return;
    const res = await patchRole(tenantAdminToken, tenantAdmin.id, 'super_admin');
    expect(res.status).toBe(403);
    await tenantAdmin.reload();
    expect(tenantAdmin.role).toBe('admin');
    expect(await deniedAudits(tenantAdmin.id)).toHaveLength(1);
  });

  test('nobody can change their own role, even to a lower one', async () => {
    if (harness === null) return;
    const res = await patchRole(tenantAdminToken, tenantAdmin.id, 'client');
    expect(res.status).toBe(403);
    await tenantAdmin.reload();
    expect(tenantAdmin.role).toBe('admin');
  });

  test('a global admin cannot grant super_admin, a role above their own', async () => {
    if (harness === null) return;
    await createUser('role-global-admin@example.com', 'admin', null);
    const target = await createUser('role-global-staff@example.com', 'staff', null);
    const token = await login('role-global-admin@example.com');
    const res = await patchRole(token, target.id, 'super_admin');
    expect(res.status).toBe(403);
    expect(await deniedAudits(target.id)).toHaveLength(1);
  });

  test('a global admin cannot demote a super_admin who outranks them', async () => {
    if (harness === null) return;
    await createUser('role-global-admin-2@example.com', 'admin', null);
    const superAdmin = await createUser('role-super-target@example.com', 'super_admin', null);
    const token = await login('role-global-admin-2@example.com');
    const res = await patchRole(token, superAdmin.id, 'client');
    expect(res.status).toBe(403);
    await superAdmin.reload();
    expect(superAdmin.role).toBe('super_admin');
  });

  test('even a super_admin cannot put the super_admin role inside a tenant', async () => {
    if (harness === null) return;
    await createUser('role-super@example.com', 'super_admin', null);
    const token = await login('role-super@example.com');
    const res = await patchRole(token, tenantStaff.id, 'super_admin');
    expect(res.status).toBe(403);
    await tenantStaff.reload();
    expect(tenantStaff.role).toBe('staff');
  });

  test('a permitted change still succeeds and is audited as user.update', async () => {
    if (harness === null) return;
    const target = await createUser('role-client@example.com', 'client', tenantAdmin.tenantId);
    const res = await patchRole(tenantAdminToken, target.id, 'staff');
    expect(res.status).toBe(200);
    expect(res.body.data.role).toBe('staff');
    const rows = await AuditLog.findAll({
      where: { action: 'user.update', resourceId: target.id },
    });
    expect(rows).toHaveLength(1);
  });

  test('a super_admin can still grant super_admin to a global user', async () => {
    if (harness === null) return;
    await createUser('role-super-2@example.com', 'super_admin', null);
    const target = await createUser('role-global-staff-2@example.com', 'staff', null);
    const token = await login('role-super-2@example.com');
    const res = await patchRole(token, target.id, 'super_admin');
    expect(res.status).toBe(200);
  });
});
