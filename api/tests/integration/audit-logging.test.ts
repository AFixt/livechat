import request from 'supertest';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';

import { AuditLog, Tenant, User } from '../../src/models/index.js';

import { probeHarness } from './setup.js';

import type { Role } from '@livechat/shared';

type Harness = Awaited<ReturnType<typeof probeHarness>>;

let harness: Harness;

const UA = 'audit-test-agent/1.0';

/**
 * Create a tenant with the fields the model requires.
 * @param slug - Unique slug.
 * @returns The created tenant.
 */
async function seedTenant(slug: string): Promise<Tenant> {
  return Tenant.create({
    name: `Audit ${slug}`,
    slug,
    status: 'active',
    domain: null,
    expiresAt: null,
    settings: null,
  });
}

/**
 * Create a user. `passwordHash` is set to plaintext — a model hook bcrypts it.
 * @param role - Role to assign.
 * @param tenantId - Owning tenant, or null.
 * @returns The user and its plaintext password.
 */
async function seedUser(
  role: Role,
  tenantId: string | null,
): Promise<{ user: User; password: string }> {
  const password = 'Aud1t!Password';
  const user = await User.create({
    email: `audit-${role}-${Math.random().toString(36).slice(2, 8)}@example.com`,
    passwordHash: password,
    firstName: 'Audit',
    lastName: role,
    role,
    tenantId,
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
  return { user, password };
}

/**
 * Wait for an audit row matching `action` (and optionally a predicate).
 *
 * Denials are recorded detached from the response, so a row can land just after
 * the request resolves; polling avoids a flaky race without an arbitrary sleep.
 * Matching is by predicate rather than "newest row", because `audit_logs` has
 * no auto-increment column and `created_at` is second-granular — several rows
 * written in the same second tie, and ordering between them is arbitrary.
 * @param action - The action to look for.
 * @param match - Optional extra predicate to disambiguate rows.
 * @returns The matching row, or null if it never arrives.
 */
async function waitForAudit(
  action: string,
  match?: (row: AuditLog) => boolean,
): Promise<AuditLog | null> {
  for (let attempt = 0; attempt < 25; attempt += 1) {
    const rows = await AuditLog.findAll({ where: { action } });
    const found = rows.find((row) => match === undefined || match(row));
    if (found !== undefined) return found;
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
  return null;
}

/**
 * Read the `path` recorded in a denial row's metadata.
 * @param row - The audit row.
 * @returns The path, or an empty string.
 */
function auditPath(row: AuditLog): string {
  const meta = row.metadata ?? {};
  return typeof meta.path === 'string' ? meta.path : '';
}

describe('audit logging (integration)', () => {
  beforeAll(async () => {
    harness = await probeHarness();
    if (harness === null) {
      console.warn('[integration] MySQL or Redis not reachable — skipping');
    }
  }, 60_000);

  afterAll(async () => {
    if (harness !== null) await harness.cleanup();
  });

  test('records a successful login with actor and request context', async () => {
    if (harness === null) return;
    const { app } = harness;
    const tenant = await seedTenant(`login-${Math.random().toString(36).slice(2, 8)}`);
    const { user, password } = await seedUser('admin', tenant.id);

    const res = await request(app)
      .post('/api/v1/auth/login')
      .set('user-agent', UA)
      .send({ email: user.email, password });
    expect(res.status).toBe(200);

    const row = await waitForAudit('auth.login');
    expect(row).not.toBeNull();
    expect(row?.userId).toBe(user.id);
    expect(row?.tenantId).toBe(tenant.id);
    expect(row?.userAgent).toBe(UA);
    expect(row?.ipAddress).not.toBeNull();
  });

  test('records a failed login without leaking the attempted password', async () => {
    if (harness === null) return;
    const { app } = harness;
    const { user } = await seedUser('staff', null);

    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: user.email, password: 'WrongPassword1!' });
    expect(res.status).toBe(401);

    const row = await waitForAudit('auth.login_failed');
    expect(row).not.toBeNull();
    expect(row?.metadata).toMatchObject({ email: user.email });
    expect(JSON.stringify(row?.metadata)).not.toContain('WrongPassword1!');
  });

  test('records logout and password change for the acting user', async () => {
    if (harness === null) return;
    const { app } = harness;
    const { user, password } = await seedUser('staff', null);
    const login = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: user.email, password });
    const token = login.body.data.accessToken as string;

    const changed = await request(app)
      .put('/api/v1/auth/change-password')
      .set('authorization', `Bearer ${token}`)
      .send({ currentPassword: password, newPassword: 'An0ther!Password' });
    expect(changed.status).toBe(200);
    const changeRow = await waitForAudit('auth.password_changed');
    expect(changeRow?.userId).toBe(user.id);

    const relogin = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: user.email, password: 'An0ther!Password' });
    const logout = await request(app)
      .post('/api/v1/auth/logout')
      .set('authorization', `Bearer ${relogin.body.data.accessToken as string}`);
    expect(logout.status).toBe(200);
    expect(await waitForAudit('auth.logout')).not.toBeNull();
  });

  test('records admin mutations against the affected resource', async () => {
    if (harness === null) return;
    const { app } = harness;
    const { user, password } = await seedUser('super_admin', null);
    const token = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: user.email, password });
    const auth = `Bearer ${token.body.data.accessToken as string}`;
    const slug = `made-${Math.random().toString(36).slice(2, 8)}`;

    const created = await request(app)
      .post('/api/v1/tenants')
      .set('authorization', auth)
      .send({ name: 'Made By Audit', slug });
    expect(created.status).toBe(201);
    const createRow = await waitForAudit('tenant.create');
    expect(createRow?.resourceId).toBe(created.body.data.id);
    expect(createRow?.userId).toBe(user.id);

    const target = await seedUser('staff', created.body.data.id as string);
    const updated = await request(app)
      .patch(`/api/v1/users/${target.user.id}`)
      .set('authorization', auth)
      .send({ status: 'suspended' });
    expect(updated.status).toBe(200);
    const updateRow = await waitForAudit('user.update');
    expect(updateRow?.resourceId).toBe(target.user.id);
    expect(updateRow?.metadata).toMatchObject({ fields: ['status'] });
  });

  test('records the embed-secret rotation without recording the secret', async () => {
    if (harness === null) return;
    const { app } = harness;
    const { user, password } = await seedUser('super_admin', null);
    const login = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: user.email, password });
    const auth = `Bearer ${login.body.data.accessToken as string}`;
    const tenant = await seedTenant(`rot-${Math.random().toString(36).slice(2, 8)}`);

    const res = await request(app)
      .post(`/api/v1/tenants/${tenant.id}/rotate-embed-secret`)
      .set('authorization', auth);
    expect(res.status).toBe(200);

    const row = await waitForAudit('tenant.rotate_embed_secret');
    expect(row?.resourceId).toBe(tenant.id);
    const secret = res.body.data.embedSecret as string | undefined;
    if (typeof secret === 'string') {
      expect(JSON.stringify(row)).not.toContain(secret);
    }
  });

  test('records an unauthenticated request as a denial', async () => {
    if (harness === null) return;
    const { app } = harness;
    const res = await request(app).get('/api/v1/tenants');
    expect(res.status).toBe(401);

    const row = await waitForAudit('auth.denied', (r) => auditPath(r).includes('tenants'));
    expect(row).not.toBeNull();
    expect(row?.metadata).toMatchObject({ method: 'GET' });
  });

  test('records a cross-tenant attempt as an access denial', async () => {
    if (harness === null) return;
    const { app } = harness;
    const own = await seedTenant(`deny-own-${Math.random().toString(36).slice(2, 8)}`);
    const other = await seedTenant(`deny-other-${Math.random().toString(36).slice(2, 8)}`);
    const { user, password } = await seedUser('admin', own.id);
    const login = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: user.email, password });
    const auth = `Bearer ${login.body.data.accessToken as string}`;

    const res = await request(app).get(`/api/v1/tenants/${other.id}`).set('authorization', auth);
    expect(res.status).toBe(403);

    // The whole point of issue #46: the probe leaves a trail naming the actor.
    const row = await waitForAudit('access.denied', (r) => auditPath(r).includes(other.id));
    expect(row).not.toBeNull();
    expect(row?.userId).toBe(user.id);
    expect(row?.tenantId).toBe(own.id);
    expect(row?.metadata).toMatchObject({ method: 'GET' });
  });
});
