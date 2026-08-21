import request from 'supertest';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';

import { Tenant, User, VisitorSession } from '../../src/models/index.js';

import { probeHarness } from './setup.js';

import type { Express } from 'express';

type Harness = Awaited<ReturnType<typeof probeHarness>>;

const STAFF_PASSWORD = 'Staff!Password1';
let counter = 0;

/**
 * Create a tenant with one staff member (or an untenanted operator).
 * @param slug - Unique tenant slug, or null for an untenanted operator.
 * @returns Tenant id (null when untenanted) and login credentials.
 */
async function seedTenantStaff(
  slug: string | null,
): Promise<{ tenantId: string | null; email: string; password: string }> {
  counter += 1;
  let tenantId: string | null = null;
  if (slug !== null) {
    const tenant = await Tenant.create({
      name: `Tenant-${slug}`,
      slug,
      status: 'active',
      domain: null,
      expiresAt: null,
      settings: null,
      allowedOrigins: null,
    });
    tenantId = tenant.id;
  }
  const email = `revoke${String(counter)}@example.com`;
  await User.create({
    email,
    passwordHash: STAFF_PASSWORD,
    firstName: 'St',
    lastName: 'Aff',
    role: 'staff',
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
  return { tenantId, email, password: STAFF_PASSWORD };
}

/**
 * Log in and return the bearer token.
 * @param app - The Express app.
 * @param email - Account email.
 * @param password - Account password.
 * @returns The access token.
 */
async function loginAs(app: Express, email: string, password: string): Promise<string> {
  const res = await request(app).post('/api/v1/auth/login').send({ email, password });
  expect(res.status).toBe(200);
  return res.body.data.accessToken as string;
}

/**
 * Boot a visitor session for a tenant and return its cookie + row id.
 * @param app - The Express app.
 * @param tenantKey - Tenant slug.
 * @returns The set-cookie header value and the visitor session id.
 */
async function bootVisitor(
  app: Express,
  tenantKey: string,
): Promise<{ cookie: string; id: string }> {
  const res = await request(app).post('/api/v1/visitor/session').send({ tenantKey });
  expect(res.status).toBe(201);
  const cookie = (res.headers['set-cookie'] as unknown as string[])[0] ?? '';
  return { cookie, id: res.body.data.sessionId as string };
}

describe('staff revocation of a visitor session (#123)', () => {
  let harness: Harness;
  let app: Express;

  beforeAll(async () => {
    harness = await probeHarness();
    if (harness === null) {
      console.warn('[integration] MySQL or Redis not reachable — skipping');
      return;
    }
    app = harness.app;
  }, 60_000);

  afterAll(async () => {
    if (harness !== null) await harness.cleanup();
  });

  test('revoking stops the visitor cookie working on the HTTP routes', async () => {
    if (harness === null) return;
    const staff = await seedTenantStaff('revoke-a');
    const token = await loginAs(app, staff.email, staff.password);
    const visitor = await bootVisitor(app, 'revoke-a');

    // The cookie works before revocation.
    const before = await request(app)
      .get('/api/v1/visitor/chats/current')
      .set('Cookie', visitor.cookie);
    expect(before.status).toBe(200);

    const revoke = await request(app)
      .delete(`/api/v1/visitor-sessions/${visitor.id}`)
      .set('Authorization', `Bearer ${token}`);
    expect(revoke.status).toBe(200);

    // ...and not after. This is #94's existing rejection path, reached because
    // the row is gone — no new gate was added.
    const after = await request(app)
      .get('/api/v1/visitor/chats/current')
      .set('Cookie', visitor.cookie);
    expect(after.status).toBe(401);
  });

  test('the session row is hard-deleted, not soft-deleted', async () => {
    if (harness === null) return;
    const staff = await seedTenantStaff('revoke-b');
    const token = await loginAs(app, staff.email, staff.password);
    const visitor = await bootVisitor(app, 'revoke-b');

    await request(app)
      .delete(`/api/v1/visitor-sessions/${visitor.id}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    // `paranoid: true` means a soft delete would leave the row findable with
    // `paranoid: false` — and, worse, still resolvable by cookie hash.
    const row = await VisitorSession.findByPk(visitor.id, { paranoid: false });
    expect(row).toBeNull();
  });

  test('a tenanted operator cannot revoke another tenant’s visitor', async () => {
    if (harness === null) return;
    await seedTenantStaff('revoke-c');
    const other = await seedTenantStaff('revoke-d');
    const otherToken = await loginAs(app, other.email, other.password);
    const visitor = await bootVisitor(app, 'revoke-c');

    const res = await request(app)
      .delete(`/api/v1/visitor-sessions/${visitor.id}`)
      .set('Authorization', `Bearer ${otherToken}`);
    expect(res.status).toBe(403);

    // Still usable — a refused revocation must not partially take effect.
    const still = await request(app)
      .get('/api/v1/visitor/chats/current')
      .set('Cookie', visitor.cookie);
    expect(still.status).toBe(200);
  });

  test('an untenanted AFixt operator may revoke any tenant’s visitor', async () => {
    if (harness === null) return;
    await seedTenantStaff('revoke-e');
    const global = await seedTenantStaff(null);
    const token = await loginAs(app, global.email, global.password);
    const visitor = await bootVisitor(app, 'revoke-e');

    await request(app)
      .delete(`/api/v1/visitor-sessions/${visitor.id}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
  });

  test('requires authentication', async () => {
    if (harness === null) return;
    await seedTenantStaff('revoke-f');
    const visitor = await bootVisitor(app, 'revoke-f');

    const res = await request(app).delete(`/api/v1/visitor-sessions/${visitor.id}`);
    expect(res.status).toBe(401);
  });

  test('an unknown session id is a 404, not a silent success', async () => {
    if (harness === null) return;
    const staff = await seedTenantStaff('revoke-g');
    const token = await loginAs(app, staff.email, staff.password);

    const res = await request(app)
      .delete('/api/v1/visitor-sessions/99999999-9999-4999-8999-999999999999')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(404);
  });

  test('an already-expired session is still revocable', async () => {
    if (harness === null) return;
    const staff = await seedTenantStaff('revoke-h');
    const token = await loginAs(app, staff.email, staff.password);
    const visitor = await bootVisitor(app, 'revoke-h');

    // Push it past the idle window: the cookie no longer works, but the row —
    // and its PII — is still there, so revocation must not depend on the
    // expiry gate.
    const row = await VisitorSession.findByPk(visitor.id);
    expect(row).not.toBeNull();
    row!.lastSeenAt = new Date(Date.now() - 1000 * 60 * 60 * 24 * 365);
    row!.firstSeenAt = new Date(Date.now() - 1000 * 60 * 60 * 24 * 365);
    await row!.save();

    const expired = await request(app)
      .get('/api/v1/visitor/chats/current')
      .set('Cookie', visitor.cookie);
    expect(expired.status).toBe(401);

    await request(app)
      .delete(`/api/v1/visitor-sessions/${visitor.id}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(await VisitorSession.findByPk(visitor.id, { paranoid: false })).toBeNull();
  });
});
