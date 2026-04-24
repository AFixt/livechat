import { randomBytes } from 'node:crypto';

import request from 'supertest';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';

import { Invitation, Tenant, User } from '../../src/models/index.js';

import { probeHarness } from './setup.js';

type Harness = Awaited<ReturnType<typeof probeHarness>>;

async function seedTenantAndAdmin(): Promise<{
  tenantId: string;
  adminEmail: string;
  adminPassword: string;
}> {
  const tenant = await Tenant.create({
    name: 'Acme',
    slug: 'acme',
    status: 'active',
    domain: null,
    expiresAt: null,
    settings: null,
  });
  const adminEmail = 'admin@example.com';
  const adminPassword = 'Admin!Password1';
  await User.create({
    email: adminEmail,
    passwordHash: adminPassword,
    firstName: 'Ad',
    lastName: 'Min',
    role: 'super_admin',
    tenantId: null,
    status: 'active',
    emailVerified: true,
    emailVerificationToken: null,
    emailVerificationExpires: null,
    passwordResetToken: null,
    passwordResetExpires: null,
    lockedUntil: null,
    lastLoginAt: null,
    phone: null,
    timezone: null,
    avatarUrl: null,
    preferences: null,
  });
  return { tenantId: tenant.id, adminEmail, adminPassword };
}

describe('auth flow (integration)', () => {
  let harness: Harness;

  beforeAll(async () => {
    harness = await probeHarness();
    if (harness === null) {
      console.warn('[integration] MySQL or Redis not reachable — skipping');
    }
  }, 20_000);

  afterAll(async () => {
    if (harness !== null) await harness.cleanup();
  });

  test.runIf(() => harness !== null)(
    'end-to-end: invite, register, verify, login, refresh, change, reset, logout',
    async () => {
      if (harness === null) return;
      const { app } = harness;
      const { adminEmail, adminPassword } = await seedTenantAndAdmin();

      const loginRes = await request(app).post('/api/v1/auth/login').send({
        email: adminEmail,
        password: adminPassword,
      });
      expect(loginRes.status).toBe(200);
      const adminAccess = loginRes.body.data.accessToken as string;
      expect(adminAccess).toBeTypeOf('string');

      const invRes = await request(app)
        .post('/api/v1/invitations')
        .set('authorization', `Bearer ${adminAccess}`)
        .send({
          email: 'newbie@example.com',
          role: 'client',
          expiresInDays: 7,
        });
      expect(invRes.status).toBe(201);

      const invitation = await Invitation.findOne({
        where: { email: 'newbie@example.com' },
      });
      expect(invitation).not.toBeNull();
      const inviteToken = invitation?.token as string;

      const regRes = await request(app).post('/api/v1/auth/register').send({
        email: 'newbie@example.com',
        password: 'NewUser!Pass1',
        firstName: 'New',
        lastName: 'Bie',
        token: inviteToken,
      });
      expect(regRes.status).toBe(201);

      const userLogin = await request(app).post('/api/v1/auth/login').send({
        email: 'newbie@example.com',
        password: 'NewUser!Pass1',
      });
      expect(userLogin.status).toBe(200);
      const userAccess = userLogin.body.data.accessToken as string;
      const userRefresh = userLogin.body.data.refreshToken as string;

      const meRes = await request(app)
        .get('/api/v1/auth/me')
        .set('authorization', `Bearer ${userAccess}`);
      expect(meRes.status).toBe(200);
      expect(meRes.body.data.email).toBe('newbie@example.com');

      const refreshRes = await request(app).post('/api/v1/auth/refresh-token').send({
        refreshToken: userRefresh,
      });
      expect(refreshRes.status).toBe(200);
      expect(refreshRes.body.data.accessToken).toBeTypeOf('string');

      const newAccess = refreshRes.body.data.accessToken as string;
      const changeRes = await request(app)
        .put('/api/v1/auth/change-password')
        .set('authorization', `Bearer ${newAccess}`)
        .send({ currentPassword: 'NewUser!Pass1', newPassword: 'Changed!Pass1' });
      expect(changeRes.status).toBe(200);

      const reLogin = await request(app).post('/api/v1/auth/login').send({
        email: 'newbie@example.com',
        password: 'Changed!Pass1',
      });
      expect(reLogin.status).toBe(200);

      const forgotRes = await request(app)
        .post('/api/v1/auth/forgot-password')
        .send({ email: 'newbie@example.com' });
      expect(forgotRes.status).toBe(200);

      const user = await User.findOne({ where: { email: 'newbie@example.com' } });
      const resetToken = user?.passwordResetToken;
      expect(resetToken).toBeTypeOf('string');

      const resetRes = await request(app).post('/api/v1/auth/reset-password').send({
        token: resetToken,
        password: 'Reset!Pass1',
      });
      expect(resetRes.status).toBe(200);

      const finalLogin = await request(app).post('/api/v1/auth/login').send({
        email: 'newbie@example.com',
        password: 'Reset!Pass1',
      });
      expect(finalLogin.status).toBe(200);
      const finalAccess = finalLogin.body.data.accessToken as string;

      const logoutRes = await request(app)
        .post('/api/v1/auth/logout')
        .set('authorization', `Bearer ${finalAccess}`);
      expect(logoutRes.status).toBe(200);

      const afterLogout = await request(app)
        .get('/api/v1/auth/me')
        .set('authorization', `Bearer ${finalAccess}`);
      expect(afterLogout.status).toBe(401);
    },
    30_000,
  );

  test.runIf(() => harness !== null)(
    'account lockout after 5 failed logins',
    async () => {
      if (harness === null) return;
      const { app } = harness;
      await User.create({
        email: 'victim@example.com',
        passwordHash: 'Real!Password1',
        firstName: 'V',
        lastName: 'X',
        role: 'client',
        tenantId: null,
        status: 'active',
        emailVerified: true,
        emailVerificationToken: null,
        emailVerificationExpires: null,
        passwordResetToken: null,
        passwordResetExpires: null,
        lockedUntil: null,
        lastLoginAt: null,
        phone: null,
        timezone: null,
        avatarUrl: null,
        preferences: null,
      });
      for (let i = 0; i < 5; i += 1) {
        const res = await request(app).post('/api/v1/auth/login').send({
          email: 'victim@example.com',
          password: 'wrong-password',
        });
        expect(res.status).toBe(401);
      }
      const locked = await request(app).post('/api/v1/auth/login').send({
        email: 'victim@example.com',
        password: 'Real!Password1',
      });
      expect(locked.status).toBe(403);
      expect(locked.body.message).toMatch(/locked/i);
    },
    30_000,
  );

  test.runIf(() => harness !== null)(
    'register rejects mismatched invitation email',
    async () => {
      if (harness === null) return;
      const { app } = harness;
      const inviter = await User.findOne({ where: { role: 'super_admin' } });
      if (inviter === null) {
        await User.create({
          email: 'root@example.com',
          passwordHash: 'Root!Password1',
          firstName: 'R',
          lastName: 'oot',
          role: 'super_admin',
          tenantId: null,
          status: 'active',
          emailVerified: true,
          emailVerificationToken: null,
          emailVerificationExpires: null,
          passwordResetToken: null,
          passwordResetExpires: null,
          lockedUntil: null,
          lastLoginAt: null,
          phone: null,
          timezone: null,
          avatarUrl: null,
          preferences: null,
        });
      }
      const fresh = (await User.findOne({ where: { role: 'super_admin' } })) as User;
      await Invitation.create({
        email: 'intended@example.com',
        role: 'client',
        token: randomBytes(16).toString('hex'),
        invitedBy: fresh.id,
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        tenantId: null,
        name: null,
        acceptedAt: null,
      });
      const invite = (await Invitation.findOne({
        where: { email: 'intended@example.com' },
      })) as Invitation;
      const res = await request(app).post('/api/v1/auth/register').send({
        email: 'different@example.com',
        password: 'Attempt!Pass1',
        firstName: 'A',
        lastName: 'B',
        token: invite.token,
      });
      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/match/i);
    },
    30_000,
  );
});
