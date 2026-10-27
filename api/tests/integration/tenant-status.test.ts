import { io as ioClient, type Socket } from 'socket.io-client';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';

import { Tenant, User } from '../../src/models/index.js';

import { integrationDbUp, probeLiveHarness, type LiveTestHarness } from './setup.js';

import type { Role } from '@livechat/shared';

const DAY_MS = 24 * 60 * 60 * 1000;
const PASSWORD = 'Tenant!Password1';

type TenantStatus = 'active' | 'suspended' | 'archived';

/**
 * Create a tenant with the given lifecycle state.
 * @param slug - Unique slug.
 * @param status - Tenant status.
 * @param expiresAt - Expiry, or null for none.
 * @returns The created tenant.
 */
async function createTenant(
  slug: string,
  status: TenantStatus,
  expiresAt: Date | null,
): Promise<Tenant> {
  return Tenant.create({ name: slug, slug, status, domain: null, expiresAt, settings: null });
}

/**
 * Create an active user with the shared test password.
 * @param email - Unique email.
 * @param role - Role to assign.
 * @param tenantId - Owning tenant, or null for a global user.
 * @returns The created user.
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
 * Resolve with the first `connect_error`, or reject if the socket connects.
 * @param socket - A freshly created client socket.
 * @returns The handshake error.
 */
function expectRefused(socket: Socket): Promise<Error> {
  return new Promise<Error>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error('handshake neither connected nor errored in time'));
    }, 4000);
    socket.once('connect_error', (err: Error) => {
      clearTimeout(timer);
      resolve(err);
    });
    socket.once('connect', () => {
      clearTimeout(timer);
      reject(new Error('handshake unexpectedly succeeded'));
    });
  });
}

describe.skipIf(!integrationDbUp)('tenant status gates every access path (#197)', () => {
  let harness: LiveTestHarness | null = null;

  beforeAll(async () => {
    harness = await probeLiveHarness();
  }, 60_000);

  afterAll(async () => {
    if (harness !== null) await harness.cleanup();
  });

  /**
   * Log a user in while their tenant is active.
   * @param email - The user's email.
   * @returns The issued token pair.
   */
  async function login(email: string): Promise<{ accessToken: string; refreshToken: string }> {
    if (harness === null) throw new Error('no harness');
    const res = await request(harness.app)
      .post('/api/v1/auth/login')
      .send({ email, password: PASSWORD });
    expect(res.status).toBe(200);
    return res.body.data as { accessToken: string; refreshToken: string };
  }

  describe('login', () => {
    const cases: [string, TenantStatus, Date | null, RegExp][] = [
      ['a suspended tenant with no expiry', 'suspended', null, /not active/i],
      [
        'a suspended tenant with a future expiry',
        'suspended',
        new Date(Date.now() + 30 * DAY_MS),
        /not active/i,
      ],
      ['an archived tenant', 'archived', null, /not active/i],
      ['an expired active tenant', 'active', new Date(Date.now() - DAY_MS), /expired/i],
    ];
    test.each(cases)('is refused for a user of %s', async (label, status, expiresAt, message) => {
      if (harness === null) return;
      const slug = `login-${label.replaceAll(' ', '-')}`;
      const tenant = await createTenant(slug, status, expiresAt);
      await createUser(`${slug}@example.com`, 'admin', tenant.id);
      const res = await request(harness.app)
        .post('/api/v1/auth/login')
        .send({ email: `${slug}@example.com`, password: PASSWORD });
      expect(res.status).toBe(403);
      expect(res.body.message).toMatch(message);
    });

    test('is refused for a user whose tenant was soft-deleted', async () => {
      if (harness === null) return;
      const tenant = await createTenant('login-deleted', 'active', null);
      await createUser('login-deleted@example.com', 'admin', tenant.id);
      await tenant.destroy();
      const res = await request(harness.app)
        .post('/api/v1/auth/login')
        .send({ email: 'login-deleted@example.com', password: PASSWORD });
      expect(res.status).toBe(403);
    });

    test('still admits a user of an active, unexpired tenant', async () => {
      if (harness === null) return;
      const tenant = await createTenant('login-active', 'active', new Date(Date.now() + DAY_MS));
      await createUser('login-active@example.com', 'admin', tenant.id);
      await login('login-active@example.com');
    });

    test('still admits an untenanted super_admin', async () => {
      if (harness === null) return;
      await createUser('login-super@example.com', 'super_admin', null);
      await login('login-super@example.com');
    });
  });

  describe('a session issued before the tenant was suspended', () => {
    test('cannot make authenticated requests', async () => {
      if (harness === null) return;
      const tenant = await createTenant('req-suspended', 'active', null);
      await createUser('req-suspended@example.com', 'admin', tenant.id);
      const { accessToken } = await login('req-suspended@example.com');
      await tenant.update({ status: 'suspended' });
      const res = await request(harness.app)
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${accessToken}`);
      expect(res.status).toBe(403);
      expect(res.body.message).toMatch(/not active/i);
    });

    test('cannot refresh its tokens', async () => {
      if (harness === null) return;
      const tenant = await createTenant('refresh-suspended', 'active', null);
      await createUser('refresh-suspended@example.com', 'admin', tenant.id);
      const { refreshToken } = await login('refresh-suspended@example.com');
      await tenant.update({ status: 'suspended' });
      const res = await request(harness.app)
        .post('/api/v1/auth/refresh-token')
        .send({ refreshToken });
      expect(res.status).toBe(403);
      expect(res.body.message).toMatch(/not active/i);
    });

    test('can still log out, so the session does not survive reactivation', async () => {
      if (harness === null) return;
      const tenant = await createTenant('logout-suspended', 'active', null);
      await createUser('logout-suspended@example.com', 'admin', tenant.id);
      const { accessToken, refreshToken } = await login('logout-suspended@example.com');
      await tenant.update({ status: 'suspended' });
      const res = await request(harness.app)
        .post('/api/v1/auth/logout')
        .set('Authorization', `Bearer ${accessToken}`);
      expect(res.status).toBe(200);

      await tenant.update({ status: 'active' });
      const refresh = await request(harness.app)
        .post('/api/v1/auth/refresh-token')
        .send({ refreshToken });
      expect(refresh.status).toBe(401);
    });

    test('cannot open a /staff socket', async () => {
      if (harness === null) return;
      const tenant = await createTenant('socket-suspended', 'active', null);
      await createUser('socket-suspended@example.com', 'staff', tenant.id);
      const { accessToken } = await login('socket-suspended@example.com');
      await tenant.update({ status: 'suspended' });
      const socket = ioClient(`${harness.baseUrl}/staff`, {
        path: '/api/socket.io',
        auth: { token: accessToken },
        transports: ['websocket'],
        forceNew: true,
      });
      const err = await expectRefused(socket);
      expect(err.message).toContain('Invalid token');
      socket.disconnect();
    }, 10_000);
  });
});
