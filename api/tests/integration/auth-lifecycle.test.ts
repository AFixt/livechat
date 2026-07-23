import { randomBytes, randomUUID } from 'node:crypto';

import request from 'supertest';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';

import { AuditLog, Invitation, Tenant, User, UserSession } from '../../src/models/index.js';

import { probeHarness } from './setup.js';

import type { Role, UserStatus } from '@livechat/shared';
import type { Express } from 'express';

type Harness = Awaited<ReturnType<typeof probeHarness>>;

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

interface UserOverrides {
  email: string;
  password: string;
  role?: Role;
  tenantId?: string | null;
  status?: UserStatus;
  emailVerified?: boolean;
  emailVerificationToken?: string | null;
  emailVerificationExpires?: Date | null;
  passwordResetToken?: string | null;
  passwordResetExpires?: Date | null;
  lockedUntil?: Date | null;
  failedLoginAttempts?: number;
}

/**
 * Create a fully-specified test user. Mirrors the field list required by
 * `InferCreationAttributes<User>` — every plain-nullable field must be
 * passed explicitly.
 * @param overrides - Per-test field overrides.
 * @returns The created user.
 */
async function createUser(overrides: UserOverrides): Promise<User> {
  return User.create({
    email: overrides.email,
    passwordHash: overrides.password,
    firstName: 'Test',
    lastName: 'User',
    role: overrides.role ?? 'client',
    tenantId: overrides.tenantId ?? null,
    status: overrides.status ?? 'active',
    emailVerified: overrides.emailVerified ?? true,
    emailVerificationToken: overrides.emailVerificationToken ?? null,
    emailVerificationExpires: overrides.emailVerificationExpires ?? null,
    passwordResetToken: overrides.passwordResetToken ?? null,
    passwordResetExpires: overrides.passwordResetExpires ?? null,
    failedLoginAttempts: overrides.failedLoginAttempts ?? 0,
    lockedUntil: overrides.lockedUntil ?? null,
    lastLoginAt: null,
    phone: null,
    timezone: null,
    avatarUrl: null,
    preferences: null,
  });
}

/**
 * Create a super_admin user and log in, returning the bearer access token.
 * @param app - The Express app under test.
 * @param email - Unique email for this admin.
 * @returns The bearer access token.
 */
async function loginAsSuperAdmin(app: Express, email: string): Promise<string> {
  const password = 'Admin!Password1';
  await createUser({ email, password, role: 'super_admin' });
  const res = await request(app).post('/api/v1/auth/login').send({ email, password });
  return res.body.data.accessToken as string;
}

describe('auth lifecycle (integration)', () => {
  let harness: Harness;

  beforeAll(async () => {
    harness = await probeHarness();
    if (harness === null) {
      console.warn('[integration] MySQL or Redis not reachable — skipping');
    }
  }, 60_000);

  afterAll(async () => {
    if (harness !== null) await harness.cleanup();
  });

  describe('forgot-password', () => {
    test.runIf(() => harness !== null)('known email issues a reset token', async () => {
      if (harness === null) return;
      const { app } = harness;
      await createUser({ email: 'forgot-known@example.com', password: 'Original!Pass1' });

      const res = await request(app)
        .post('/api/v1/auth/forgot-password')
        .send({ email: 'forgot-known@example.com' });
      expect(res.status).toBe(200);

      const user = await User.findOne({ where: { email: 'forgot-known@example.com' } });
      expect(user?.passwordResetToken).toBeTypeOf('string');
      expect(user?.passwordResetExpires).not.toBeNull();
    });

    test.runIf(() => harness !== null)(
      'unknown email returns the same response without leaking existence',
      async () => {
        if (harness === null) return;
        const { app } = harness;
        const res = await request(app)
          .post('/api/v1/auth/forgot-password')
          .send({ email: 'never-registered@example.com' });
        expect(res.status).toBe(200);
        expect(res.body.message).toMatch(/if the email exists/i);

        const user = await User.findOne({ where: { email: 'never-registered@example.com' } });
        expect(user).toBeNull();
      },
    );
  });

  describe('reset-password', () => {
    test.runIf(() => harness !== null)(
      'valid token resets the password, is single-use, and destroys sessions',
      async () => {
        if (harness === null) return;
        const { app } = harness;
        await createUser({ email: 'reset-valid@example.com', password: 'Original!Pass1' });

        const loginRes = await request(app).post('/api/v1/auth/login').send({
          email: 'reset-valid@example.com',
          password: 'Original!Pass1',
        });
        expect(loginRes.status).toBe(200);
        const preResetRefresh = loginRes.body.data.refreshToken as string;

        await request(app)
          .post('/api/v1/auth/forgot-password')
          .send({ email: 'reset-valid@example.com' });
        const user = await User.findOne({ where: { email: 'reset-valid@example.com' } });
        const token = user?.passwordResetToken;
        expect(token).toBeTypeOf('string');

        const resetRes = await request(app)
          .post('/api/v1/auth/reset-password')
          .send({ token, password: 'BrandNew!Pass1' });
        expect(resetRes.status).toBe(200);

        const loginOld = await request(app).post('/api/v1/auth/login').send({
          email: 'reset-valid@example.com',
          password: 'Original!Pass1',
        });
        expect(loginOld.status).toBe(401);

        const loginNew = await request(app).post('/api/v1/auth/login').send({
          email: 'reset-valid@example.com',
          password: 'BrandNew!Pass1',
        });
        expect(loginNew.status).toBe(200);

        // Sessions destroyed by the reset — the pre-reset refresh token is dead.
        const refreshAfterReset = await request(app)
          .post('/api/v1/auth/refresh-token')
          .send({ refreshToken: preResetRefresh });
        expect(refreshAfterReset.status).toBe(401);

        // Token is single-use — replaying it fails even with a fresh password.
        const replay = await request(app)
          .post('/api/v1/auth/reset-password')
          .send({ token, password: 'AnotherNew!Pass1' });
        expect(replay.status).toBe(400);
      },
    );

    test.runIf(() => harness !== null)('invalid token is rejected', async () => {
      if (harness === null) return;
      const { app } = harness;
      const res = await request(app)
        .post('/api/v1/auth/reset-password')
        .send({ token: 'not-a-real-token', password: 'Whatever!Pass1' });
      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/invalid/i);
    });

    test.runIf(() => harness !== null)('expired token is rejected', async () => {
      if (harness === null) return;
      const { app } = harness;
      const token = randomBytes(32).toString('hex');
      await createUser({
        email: 'reset-expired@example.com',
        password: 'Original!Pass1',
        passwordResetToken: token,
        passwordResetExpires: new Date(Date.now() - HOUR_MS),
      });

      const res = await request(app)
        .post('/api/v1/auth/reset-password')
        .send({ token, password: 'Whatever!Pass1' });
      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/expired/i);
    });
  });

  describe('change-password', () => {
    test.runIf(() => harness !== null)('correct current password succeeds', async () => {
      if (harness === null) return;
      const { app } = harness;
      await createUser({ email: 'change-ok@example.com', password: 'Original!Pass1' });
      const loginRes = await request(app).post('/api/v1/auth/login').send({
        email: 'change-ok@example.com',
        password: 'Original!Pass1',
      });
      const access = loginRes.body.data.accessToken as string;

      const changeRes = await request(app)
        .put('/api/v1/auth/change-password')
        .set('authorization', `Bearer ${access}`)
        .send({ currentPassword: 'Original!Pass1', newPassword: 'Updated!Pass1' });
      expect(changeRes.status).toBe(200);

      const relogin = await request(app).post('/api/v1/auth/login').send({
        email: 'change-ok@example.com',
        password: 'Updated!Pass1',
      });
      expect(relogin.status).toBe(200);
    });

    test.runIf(() => harness !== null)('wrong current password is rejected', async () => {
      if (harness === null) return;
      const { app } = harness;
      await createUser({ email: 'change-wrong@example.com', password: 'Original!Pass1' });
      const loginRes = await request(app).post('/api/v1/auth/login').send({
        email: 'change-wrong@example.com',
        password: 'Original!Pass1',
      });
      const access = loginRes.body.data.accessToken as string;

      const changeRes = await request(app)
        .put('/api/v1/auth/change-password')
        .set('authorization', `Bearer ${access}`)
        .send({ currentPassword: 'NotItAtAll1', newPassword: 'Updated!Pass1' });
      expect(changeRes.status).toBe(400);
      expect(changeRes.body.message).toMatch(/incorrect/i);
    });

    test.runIf(() => harness !== null)('requires authentication', async () => {
      if (harness === null) return;
      const { app } = harness;
      const res = await request(app)
        .put('/api/v1/auth/change-password')
        .send({ currentPassword: 'Whatever1', newPassword: 'Updated!Pass1' });
      expect(res.status).toBe(401);
    });
  });

  describe('verify-email/:token', () => {
    test.runIf(() => harness !== null)('valid token verifies the account', async () => {
      if (harness === null) return;
      const token = randomBytes(32).toString('hex');
      await createUser({
        email: 'verify-valid@example.com',
        password: 'Original!Pass1',
        emailVerified: false,
        emailVerificationToken: token,
        emailVerificationExpires: new Date(Date.now() + DAY_MS),
      });
      const { app } = harness;

      const res = await request(app).get(`/api/v1/auth/verify-email/${token}`);
      expect(res.status).toBe(200);

      const user = await User.findOne({ where: { email: 'verify-valid@example.com' } });
      expect(user?.emailVerified).toBe(true);
      expect(user?.emailVerificationToken).toBeNull();
    });

    test.runIf(() => harness !== null)('invalid token is rejected', async () => {
      if (harness === null) return;
      const { app } = harness;
      const res = await request(app).get('/api/v1/auth/verify-email/not-a-real-token');
      expect(res.status).toBe(400);
    });

    test.runIf(() => harness !== null)('expired token is rejected', async () => {
      if (harness === null) return;
      const token = randomBytes(32).toString('hex');
      await createUser({
        email: 'verify-expired@example.com',
        password: 'Original!Pass1',
        emailVerified: false,
        emailVerificationToken: token,
        emailVerificationExpires: new Date(Date.now() - HOUR_MS),
      });
      const { app } = harness;

      const res = await request(app).get(`/api/v1/auth/verify-email/${token}`);
      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/expired/i);
    });
  });

  describe('login edge branches', () => {
    test.runIf(() => harness !== null)('failed attempts increment the counter', async () => {
      if (harness === null) return;
      const { app } = harness;
      await createUser({ email: 'login-fail-count@example.com', password: 'Real!Password1' });

      const res = await request(app).post('/api/v1/auth/login').send({
        email: 'login-fail-count@example.com',
        password: 'wrong-password',
      });
      expect(res.status).toBe(401);

      const user = await User.findOne({ where: { email: 'login-fail-count@example.com' } });
      expect(user?.failedLoginAttempts).toBe(1);
      expect(user?.lockedUntil).toBeNull();
    });

    test.runIf(() => harness !== null)(
      'locked account rejects login even with correct password',
      async () => {
        if (harness === null) return;
        const { app } = harness;
        await createUser({
          email: 'login-locked@example.com',
          password: 'Real!Password1',
          lockedUntil: new Date(Date.now() + HOUR_MS),
          failedLoginAttempts: 5,
        });

        const res = await request(app).post('/api/v1/auth/login').send({
          email: 'login-locked@example.com',
          password: 'Real!Password1',
        });
        expect(res.status).toBe(403);
        expect(res.body.message).toMatch(/locked/i);
      },
    );

    test.runIf(() => harness !== null)('suspended account is rejected', async () => {
      if (harness === null) return;
      const { app } = harness;
      await createUser({
        email: 'login-suspended@example.com',
        password: 'Real!Password1',
        status: 'suspended',
      });

      const res = await request(app).post('/api/v1/auth/login').send({
        email: 'login-suspended@example.com',
        password: 'Real!Password1',
      });
      expect(res.status).toBe(403);
      expect(res.body.message).toMatch(/not active/i);
    });

    test.runIf(() => harness !== null)('pending account is rejected', async () => {
      if (harness === null) return;
      const { app } = harness;
      await createUser({
        email: 'login-pending@example.com',
        password: 'Real!Password1',
        status: 'pending',
      });

      const res = await request(app).post('/api/v1/auth/login').send({
        email: 'login-pending@example.com',
        password: 'Real!Password1',
      });
      expect(res.status).toBe(403);
      expect(res.body.message).toMatch(/not active/i);
    });

    test.runIf(() => harness !== null)(
      'unknown email is rejected without distinguishing detail',
      async () => {
        if (harness === null) return;
        const { app } = harness;
        const res = await request(app).post('/api/v1/auth/login').send({
          email: 'does-not-exist@example.com',
          password: 'Whatever!Pass1',
        });
        expect(res.status).toBe(401);
      },
    );
  });

  describe('refresh-token / logout', () => {
    test.runIf(() => harness !== null)(
      'refresh rotates the token and the old one is rejected',
      async () => {
        if (harness === null) return;
        const { app } = harness;
        await createUser({ email: 'refresh-rotate@example.com', password: 'Real!Password1' });
        const loginRes = await request(app).post('/api/v1/auth/login').send({
          email: 'refresh-rotate@example.com',
          password: 'Real!Password1',
        });
        const oldRefresh = loginRes.body.data.refreshToken as string;

        const refreshRes = await request(app)
          .post('/api/v1/auth/refresh-token')
          .send({ refreshToken: oldRefresh });
        expect(refreshRes.status).toBe(200);
        const newRefresh = refreshRes.body.data.refreshToken as string;
        expect(newRefresh).not.toBe(oldRefresh);

        const reuseOld = await request(app)
          .post('/api/v1/auth/refresh-token')
          .send({ refreshToken: oldRefresh });
        expect(reuseOld.status).toBe(401);

        const useNew = await request(app)
          .post('/api/v1/auth/refresh-token')
          .send({ refreshToken: newRefresh });
        expect(useNew.status).toBe(200);
      },
    );

    test.runIf(() => harness !== null)('refresh-token requires a body field', async () => {
      if (harness === null) return;
      const { app } = harness;
      const res = await request(app).post('/api/v1/auth/refresh-token').send({});
      expect(res.status).toBe(400);
    });

    test.runIf(() => harness !== null)('refresh rejects a malformed token', async () => {
      if (harness === null) return;
      const { app } = harness;
      const res = await request(app)
        .post('/api/v1/auth/refresh-token')
        .send({ refreshToken: 'garbage.not.a.jwt' });
      expect(res.status).toBe(401);
    });

    test.runIf(() => harness !== null)('refresh rejects a suspended user', async () => {
      if (harness === null) return;
      const { app } = harness;
      await createUser({ email: 'refresh-suspend@example.com', password: 'Real!Password1' });
      const loginRes = await request(app).post('/api/v1/auth/login').send({
        email: 'refresh-suspend@example.com',
        password: 'Real!Password1',
      });
      const refreshToken = loginRes.body.data.refreshToken as string;

      const user = await User.findOne({ where: { email: 'refresh-suspend@example.com' } });
      await user?.update({ status: 'suspended' });

      const res = await request(app).post('/api/v1/auth/refresh-token').send({ refreshToken });
      expect(res.status).toBe(401);
    });

    test.runIf(() => harness !== null)(
      'logout destroys the session so refresh stops working',
      async () => {
        if (harness === null) return;
        const { app } = harness;
        await createUser({ email: 'logout-destroys@example.com', password: 'Real!Password1' });
        const loginRes = await request(app).post('/api/v1/auth/login').send({
          email: 'logout-destroys@example.com',
          password: 'Real!Password1',
        });
        const access = loginRes.body.data.accessToken as string;
        const refreshToken = loginRes.body.data.refreshToken as string;

        const logoutRes = await request(app)
          .post('/api/v1/auth/logout')
          .set('authorization', `Bearer ${access}`);
        expect(logoutRes.status).toBe(200);

        const meRes = await request(app)
          .get('/api/v1/auth/me')
          .set('authorization', `Bearer ${access}`);
        expect(meRes.status).toBe(401);

        const refreshRes = await request(app)
          .post('/api/v1/auth/refresh-token')
          .send({ refreshToken });
        expect(refreshRes.status).toBe(401);
      },
    );
  });

  describe('invitations', () => {
    test.runIf(() => harness !== null)(
      'admin can create, list, and register succeeds with the token',
      async () => {
        if (harness === null) return;
        const { app } = harness;
        const adminAccess = await loginAsSuperAdmin(app, 'inv-admin-1@example.com');

        const createRes = await request(app)
          .post('/api/v1/invitations')
          .set('authorization', `Bearer ${adminAccess}`)
          .send({ email: 'invitee-1@example.com', role: 'client', expiresInDays: 7 });
        expect(createRes.status).toBe(201);

        const listRes = await request(app)
          .get('/api/v1/invitations')
          .set('authorization', `Bearer ${adminAccess}`);
        expect(listRes.status).toBe(200);
        expect(Array.isArray(listRes.body.data)).toBe(true);

        const invitation = await Invitation.findOne({ where: { email: 'invitee-1@example.com' } });
        const token = invitation?.token as string;

        const registerRes = await request(app).post('/api/v1/auth/register').send({
          email: 'invitee-1@example.com',
          password: 'NewUser!Pass1',
          firstName: 'In',
          lastName: 'Vitee',
          token,
        });
        expect(registerRes.status).toBe(201);

        const accepted = await Invitation.findOne({ where: { email: 'invitee-1@example.com' } });
        expect(accepted?.status).toBe('accepted');

        // Single-use: the same token cannot register a second account.
        const replay = await request(app).post('/api/v1/auth/register').send({
          email: 'invitee-1@example.com',
          password: 'NewUser!Pass1',
          firstName: 'In',
          lastName: 'Vitee',
          token,
        });
        expect(replay.status).toBe(400);
      },
    );

    test.runIf(() => harness !== null)('create rejects an unknown tenantId', async () => {
      if (harness === null) return;
      const { app } = harness;
      const adminAccess = await loginAsSuperAdmin(app, 'inv-admin-2@example.com');

      const res = await request(app)
        .post('/api/v1/invitations')
        .set('authorization', `Bearer ${adminAccess}`)
        .send({ email: 'invitee-2@example.com', role: 'client', tenantId: randomUUID() });
      expect(res.status).toBe(400);
    });

    test.runIf(() => harness !== null)(
      'create succeeds with a real tenantId and list can filter by it',
      async () => {
        if (harness === null) return;
        const { app } = harness;
        const adminAccess = await loginAsSuperAdmin(app, 'inv-admin-3@example.com');
        const tenant = await Tenant.create({
          name: 'Filter Co',
          slug: 'filter-co',
          status: 'active',
          domain: null,
          expiresAt: null,
          settings: null,
        });

        const createRes = await request(app)
          .post('/api/v1/invitations')
          .set('authorization', `Bearer ${adminAccess}`)
          .send({ email: 'invitee-3@example.com', role: 'staff', tenantId: tenant.id });
        expect(createRes.status).toBe(201);

        const filtered = await request(app)
          .get(`/api/v1/invitations?tenantId=${tenant.id}`)
          .set('authorization', `Bearer ${adminAccess}`);
        expect(filtered.status).toBe(200);
        const data = filtered.body.data as { email: string }[];
        const emails: string[] = [];
        for (const invite of data) emails.push(invite.email);
        expect(emails).toContain('invitee-3@example.com');
      },
    );

    test.runIf(() => harness !== null)('register rejects an unknown token', async () => {
      if (harness === null) return;
      const { app } = harness;
      const res = await request(app)
        .post('/api/v1/auth/register')
        .send({
          email: 'nobody@example.com',
          password: 'Whatever!Pass1',
          firstName: 'No',
          lastName: 'Body',
          token: randomBytes(16).toString('hex'),
        });
      expect(res.status).toBe(400);
    });

    test.runIf(() => harness !== null)(
      'register rejects an expired invitation and marks it expired',
      async () => {
        if (harness === null) return;
        const { app } = harness;
        await loginAsSuperAdmin(app, 'inv-admin-4@example.com');
        const admin = await User.findOne({ where: { email: 'inv-admin-4@example.com' } });
        const invitation = await Invitation.create({
          email: 'expired-invite@example.com',
          role: 'client',
          token: randomBytes(16).toString('hex'),
          invitedBy: (admin as User).id,
          expiresAt: new Date(Date.now() - HOUR_MS),
          tenantId: null,
          name: null,
          acceptedAt: null,
        });

        const res = await request(app).post('/api/v1/auth/register').send({
          email: 'expired-invite@example.com',
          password: 'Whatever!Pass1',
          firstName: 'Ex',
          lastName: 'Pired',
          token: invitation.token,
        });
        expect(res.status).toBe(400);
        expect(res.body.message).toMatch(/expired/i);

        const reloaded = await Invitation.findByPk(invitation.id);
        expect(reloaded?.status).toBe('expired');
      },
    );

    test.runIf(() => harness !== null)(
      'register rejects an already-accepted invitation',
      async () => {
        if (harness === null) return;
        const { app } = harness;
        await loginAsSuperAdmin(app, 'inv-admin-5@example.com');
        const admin = await User.findOne({ where: { email: 'inv-admin-5@example.com' } });
        const invitation = await Invitation.create({
          email: 'already-accepted@example.com',
          role: 'client',
          token: randomBytes(16).toString('hex'),
          invitedBy: (admin as User).id,
          expiresAt: new Date(Date.now() + DAY_MS),
          tenantId: null,
          name: null,
          acceptedAt: new Date(),
          status: 'accepted',
        });

        const res = await request(app).post('/api/v1/auth/register').send({
          email: 'already-accepted@example.com',
          password: 'Whatever!Pass1',
          firstName: 'Al',
          lastName: 'Ready',
          token: invitation.token,
        });
        expect(res.status).toBe(400);
      },
    );

    test.runIf(() => harness !== null)('register rejects a revoked invitation', async () => {
      if (harness === null) return;
      const { app } = harness;
      await loginAsSuperAdmin(app, 'inv-admin-6@example.com');
      const admin = await User.findOne({ where: { email: 'inv-admin-6@example.com' } });
      const invitation = await Invitation.create({
        email: 'revoked-invite@example.com',
        role: 'client',
        token: randomBytes(16).toString('hex'),
        invitedBy: (admin as User).id,
        expiresAt: new Date(Date.now() + DAY_MS),
        tenantId: null,
        name: null,
        acceptedAt: null,
        status: 'revoked',
      });

      const res = await request(app).post('/api/v1/auth/register').send({
        email: 'revoked-invite@example.com',
        password: 'Whatever!Pass1',
        firstName: 'Re',
        lastName: 'Voked',
        token: invitation.token,
      });
      expect(res.status).toBe(400);
    });

    test.runIf(() => harness !== null)(
      'register rejects an email that no longer matches the invitation',
      async () => {
        if (harness === null) return;
        const { app } = harness;
        await loginAsSuperAdmin(app, 'inv-admin-7@example.com');
        const admin = await User.findOne({ where: { email: 'inv-admin-7@example.com' } });
        const invitation = await Invitation.create({
          email: 'target@example.com',
          role: 'client',
          token: randomBytes(16).toString('hex'),
          invitedBy: (admin as User).id,
          expiresAt: new Date(Date.now() + DAY_MS),
          tenantId: null,
          name: null,
          acceptedAt: null,
        });
        await createUser({ email: 'target@example.com', password: 'Existing!Pass1' });

        const res = await request(app).post('/api/v1/auth/register').send({
          email: 'target@example.com',
          password: 'Whatever!Pass1',
          firstName: 'Ta',
          lastName: 'Rget',
          token: invitation.token,
        });
        expect(res.status).toBe(409);
        expect(res.body.message).toMatch(/already registered/i);
      },
    );

    test.runIf(() => harness !== null)('revoke succeeds for a pending invitation', async () => {
      if (harness === null) return;
      const { app } = harness;
      const adminAccess = await loginAsSuperAdmin(app, 'inv-admin-8@example.com');
      const createRes = await request(app)
        .post('/api/v1/invitations')
        .set('authorization', `Bearer ${adminAccess}`)
        .send({ email: 'revoke-me@example.com', role: 'client' });
      expect(createRes.status).toBe(201);
      const invitation = await Invitation.findOne({ where: { email: 'revoke-me@example.com' } });

      const revokeRes = await request(app)
        .post(`/api/v1/invitations/${(invitation as Invitation).id}/revoke`)
        .set('authorization', `Bearer ${adminAccess}`);
      expect(revokeRes.status).toBe(200);

      const reloaded = await Invitation.findByPk((invitation as Invitation).id);
      expect(reloaded?.status).toBe('revoked');
    });

    test.runIf(() => harness !== null)('revoke rejects a non-pending invitation', async () => {
      if (harness === null) return;
      const { app } = harness;
      const adminAccess = await loginAsSuperAdmin(app, 'inv-admin-9@example.com');
      const admin = await User.findOne({ where: { email: 'inv-admin-9@example.com' } });
      const invitation = await Invitation.create({
        email: 'already-revoked@example.com',
        role: 'client',
        token: randomBytes(16).toString('hex'),
        invitedBy: (admin as User).id,
        expiresAt: new Date(Date.now() + DAY_MS),
        tenantId: null,
        name: null,
        acceptedAt: null,
        status: 'revoked',
      });

      const res = await request(app)
        .post(`/api/v1/invitations/${invitation.id}/revoke`)
        .set('authorization', `Bearer ${adminAccess}`);
      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/revoked/i);
    });

    test.runIf(() => harness !== null)('revoke of an unknown invitation is 404', async () => {
      if (harness === null) return;
      const { app } = harness;
      const adminAccess = await loginAsSuperAdmin(app, 'inv-admin-10@example.com');

      const res = await request(app)
        .post(`/api/v1/invitations/${randomUUID()}/revoke`)
        .set('authorization', `Bearer ${adminAccess}`);
      expect(res.status).toBe(404);
    });

    test.runIf(() => harness !== null)(
      'invitations endpoints require admin/super_admin',
      async () => {
        if (harness === null) return;
        const { app } = harness;
        await createUser({ email: 'plain-client@example.com', password: 'Real!Password1' });
        const loginRes = await request(app).post('/api/v1/auth/login').send({
          email: 'plain-client@example.com',
          password: 'Real!Password1',
        });
        const clientAccess = loginRes.body.data.accessToken as string;

        const res = await request(app)
          .post('/api/v1/invitations')
          .set('authorization', `Bearer ${clientAccess}`)
          .send({ email: 'someone@example.com', role: 'client' });
        expect(res.status).toBe(403);
      },
    );
  });

  describe('audit-service', () => {
    test.runIf(() => harness !== null)('records a login-shaped entry', async () => {
      if (harness === null) return;
      const user = await createUser({
        email: 'audit-login@example.com',
        password: 'Real!Password1',
      });

      await harness.services.audit.record({
        userId: user.id,
        action: 'auth.login',
        resourceType: 'user',
        resourceId: user.id,
        ipAddress: '127.0.0.1',
        userAgent: 'vitest',
      });

      const row = await AuditLog.findOne({ where: { userId: user.id, action: 'auth.login' } });
      expect(row).not.toBeNull();
      expect(row?.resourceType).toBe('user');
      expect(row?.ipAddress).toBe('127.0.0.1');
    });

    test.runIf(() => harness !== null)(
      'records an admin-action-shaped entry with metadata',
      async () => {
        if (harness === null) return;
        const admin = await createUser({
          email: 'audit-admin@example.com',
          password: 'Real!Password1',
          role: 'super_admin',
        });

        await harness.services.audit.record({
          userId: admin.id,
          action: 'invitation.create',
          resourceType: 'invitation',
          resourceId: randomUUID(),
          metadata: { email: 'invitee@example.com', role: 'client' },
        });

        const row = await AuditLog.findOne({
          where: { userId: admin.id, action: 'invitation.create' },
        });
        expect(row).not.toBeNull();
        expect(row?.metadata).toEqual({ email: 'invitee@example.com', role: 'client' });
      },
    );

    test.runIf(() => harness !== null)('swallows write failures instead of throwing', async () => {
      if (harness === null) return;
      // userId references `users.id` with an FK constraint — a well-formed
      // but non-existent UUID trips the FK violation inside `AuditLog.create`,
      // exercising the service's catch branch without ever throwing here.
      await expect(
        harness.services.audit.record({
          userId: randomUUID(),
          action: 'audit.fk-violation',
        }),
      ).resolves.toBeUndefined();

      const row = await AuditLog.findOne({ where: { action: 'audit.fk-violation' } });
      expect(row).toBeNull();
    });
  });

  describe('UserSession bookkeeping sanity', () => {
    test.runIf(() => harness !== null)(
      'login creates exactly one session row per login',
      async () => {
        if (harness === null) return;
        const { app } = harness;
        await createUser({ email: 'session-count@example.com', password: 'Real!Password1' });
        const user = await User.findOne({ where: { email: 'session-count@example.com' } });

        await request(app).post('/api/v1/auth/login').send({
          email: 'session-count@example.com',
          password: 'Real!Password1',
        });

        const sessions = await UserSession.findAll({ where: { userId: (user as User).id } });
        expect(sessions.length).toBe(1);
      },
    );
  });
});
