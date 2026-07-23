import request from 'supertest';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';

import { Tenant, User } from '../../src/models/index.js';

import { probeHarness } from './setup.js';

import type { Role } from '@livechat/shared';

type Harness = Awaited<ReturnType<typeof probeHarness>>;

let harness: Harness;

/**
 * Create a tenant with sane defaults for the fields the model requires.
 * @param overrides - Partial field overrides.
 * @returns The created tenant.
 */
async function seedTenant(
  overrides: Partial<{ name: string; slug: string }> = {},
): Promise<Tenant> {
  return Tenant.create({
    name: overrides.name ?? 'Acme Corp',
    slug: overrides.slug ?? `acme-${Math.random().toString(36).slice(2, 8)}`,
    status: 'active',
    domain: null,
    expiresAt: null,
    settings: null,
  });
}

/**
 * Create a user with a given role/tenant and return its plaintext password
 * for login. `passwordHash` is set to plaintext — the model's `beforeCreate`
 * hook bcrypt-hashes it.
 * @param role - Role to assign.
 * @param tenantId - Tenant id, or `null` for untenanted roles.
 * @param overrides - Optional email override so callers can avoid collisions.
 * @returns The created user and its plaintext password.
 */
async function seedUser(
  role: Role,
  tenantId: string | null,
  overrides: Partial<{ email: string }> = {},
): Promise<{ user: User; password: string }> {
  const password = 'Sup3r!Secret1';
  const user = await User.create({
    email: overrides.email ?? `${role}-${Math.random().toString(36).slice(2, 8)}@example.com`,
    passwordHash: password,
    firstName: 'Test',
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
 * Log a seeded user in and return an access token.
 * @param email - Login email.
 * @param password - Plaintext password.
 * @returns Bearer access token.
 */
async function login(email: string, password: string): Promise<string> {
  if (harness === null) throw new Error('harness not initialized');
  const res = await request(harness.app).post('/api/v1/auth/login').send({ email, password });
  expect(res.status).toBe(200);
  return res.body.data.accessToken as string;
}

describe('admin routes (integration)', () => {
  beforeAll(async () => {
    harness = await probeHarness();
    if (harness === null) {
      console.warn('[integration] MySQL or Redis not reachable — skipping');
    }
  }, 60_000);

  afterAll(async () => {
    if (harness !== null) await harness.cleanup();
  });

  describe('authentication and authorization guards', () => {
    test.runIf(() => harness !== null)(
      'unauthenticated requests are rejected with 401',
      async () => {
        if (harness === null) return;
        const { app } = harness;

        const getTenants = await request(app).get('/api/v1/tenants');
        expect(getTenants.status).toBe(401);
        expect(getTenants.body.success).toBe(false);

        const postTenants = await request(app).post('/api/v1/tenants').send({});
        expect(postTenants.status).toBe(401);

        const tenant = await seedTenant();
        const patchTenant = await request(app).patch(`/api/v1/tenants/${tenant.id}`).send({});
        expect(patchTenant.status).toBe(401);

        const deleteTenant = await request(app).delete(`/api/v1/tenants/${tenant.id}`);
        expect(deleteTenant.status).toBe(401);

        const rotate = await request(app).post(`/api/v1/tenants/${tenant.id}/rotate-embed-secret`);
        expect(rotate.status).toBe(401);

        const origins = await request(app)
          .put(`/api/v1/tenants/${tenant.id}/allowed-origins`)
          .send({});
        expect(origins.status).toBe(401);

        const getUsers = await request(app).get('/api/v1/users');
        expect(getUsers.status).toBe(401);

        const patchUser = await request(app).patch('/api/v1/users/some-id').send({});
        expect(patchUser.status).toBe(401);
      },
    );

    test.runIf(() => harness !== null)(
      'a malformed bearer token is rejected with 401',
      async () => {
        if (harness === null) return;
        const { app } = harness;
        const res = await request(app)
          .get('/api/v1/tenants')
          .set('authorization', 'Bearer not-a-real-token');
        expect(res.status).toBe(401);
      },
    );

    test.runIf(() => harness !== null)(
      'staff cannot reach any /tenants or /users route (403 — admin-router base guard)',
      async () => {
        if (harness === null) return;
        const { app } = harness;
        const { user, password } = await seedUser('staff', null);
        const token = await login(user.email, password);
        const tenant = await seedTenant();

        const list = await request(app)
          .get('/api/v1/tenants')
          .set('authorization', `Bearer ${token}`);
        expect(list.status).toBe(403);
        expect(list.body.message).toMatch(/permission/i);

        const create = await request(app)
          .post('/api/v1/tenants')
          .set('authorization', `Bearer ${token}`)
          .send({ name: 'Nope', slug: 'nope' });
        expect(create.status).toBe(403);

        const getOne = await request(app)
          .get(`/api/v1/tenants/${tenant.id}`)
          .set('authorization', `Bearer ${token}`);
        expect(getOne.status).toBe(403);

        const patchOne = await request(app)
          .patch(`/api/v1/tenants/${tenant.id}`)
          .set('authorization', `Bearer ${token}`)
          .send({ name: 'Nope' });
        expect(patchOne.status).toBe(403);

        const deleteOne = await request(app)
          .delete(`/api/v1/tenants/${tenant.id}`)
          .set('authorization', `Bearer ${token}`);
        expect(deleteOne.status).toBe(403);

        const rotate = await request(app)
          .post(`/api/v1/tenants/${tenant.id}/rotate-embed-secret`)
          .set('authorization', `Bearer ${token}`);
        expect(rotate.status).toBe(403);

        const origins = await request(app)
          .put(`/api/v1/tenants/${tenant.id}/allowed-origins`)
          .set('authorization', `Bearer ${token}`)
          .send({ origins: ['https://example.com'] });
        expect(origins.status).toBe(403);

        const listUsers = await request(app)
          .get('/api/v1/users')
          .set('authorization', `Bearer ${token}`);
        expect(listUsers.status).toBe(403);

        const patchUser = await request(app)
          .patch(`/api/v1/users/${user.id}`)
          .set('authorization', `Bearer ${token}`)
          .send({ firstName: 'X' });
        expect(patchUser.status).toBe(403);
      },
    );

    test.runIf(() => harness !== null)(
      'client role cannot reach any /tenants or /users route (403)',
      async () => {
        if (harness === null) return;
        const { app } = harness;
        const tenant = await seedTenant();
        const { user, password } = await seedUser('client', tenant.id);
        const token = await login(user.email, password);

        const list = await request(app)
          .get('/api/v1/tenants')
          .set('authorization', `Bearer ${token}`);
        expect(list.status).toBe(403);

        const listUsers = await request(app)
          .get('/api/v1/users')
          .set('authorization', `Bearer ${token}`);
        expect(listUsers.status).toBe(403);
      },
    );

    test.runIf(() => harness !== null)(
      'tenant-scoped admin is forbidden from super_admin-only tenant mutations (403)',
      async () => {
        if (harness === null) return;
        const { app } = harness;
        const ownTenant = await seedTenant();
        const otherTenant = await seedTenant();
        const { user, password } = await seedUser('admin', ownTenant.id);
        const token = await login(user.email, password);

        const create = await request(app)
          .post('/api/v1/tenants')
          .set('authorization', `Bearer ${token}`)
          .send({ name: 'Blocked', slug: `blocked-${Math.random().toString(36).slice(2, 8)}` });
        expect(create.status).toBe(403);

        const patchOwn = await request(app)
          .patch(`/api/v1/tenants/${ownTenant.id}`)
          .set('authorization', `Bearer ${token}`)
          .send({ name: 'Renamed' });
        expect(patchOwn.status).toBe(403);

        const patchOther = await request(app)
          .patch(`/api/v1/tenants/${otherTenant.id}`)
          .set('authorization', `Bearer ${token}`)
          .send({ name: 'Renamed' });
        expect(patchOther.status).toBe(403);

        const deleteOther = await request(app)
          .delete(`/api/v1/tenants/${otherTenant.id}`)
          .set('authorization', `Bearer ${token}`);
        expect(deleteOther.status).toBe(403);

        const rotate = await request(app)
          .post(`/api/v1/tenants/${otherTenant.id}/rotate-embed-secret`)
          .set('authorization', `Bearer ${token}`);
        expect(rotate.status).toBe(403);

        const origins = await request(app)
          .put(`/api/v1/tenants/${otherTenant.id}/allowed-origins`)
          .set('authorization', `Bearer ${token}`)
          .send({ origins: ['https://example.com'] });
        expect(origins.status).toBe(403);

        // A tenant-scoped admin cannot read a tenant it is not scoped to
        // (issue #43). Only untenanted AFixt staff get cross-tenant visibility.
        const readOther = await request(app)
          .get(`/api/v1/tenants/${otherTenant.id}`)
          .set('authorization', `Bearer ${token}`);
        expect(readOther.status).toBe(403);
      },
    );
  });

  describe('/tenants CRUD', () => {
    test.runIf(() => harness !== null)('list returns all tenants for an admin', async () => {
      if (harness === null) return;
      const { app } = harness;
      await seedTenant();
      const { user, password } = await seedUser('admin', null);
      const token = await login(user.email, password);

      const res = await request(app).get('/api/v1/tenants').set('authorization', `Bearer ${token}`);
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.data.length).toBeGreaterThan(0);
    });

    test.runIf(() => harness !== null)(
      'create succeeds for super_admin with a valid payload',
      async () => {
        if (harness === null) return;
        const { app } = harness;
        const { user, password } = await seedUser('super_admin', null);
        const token = await login(user.email, password);

        const res = await request(app)
          .post('/api/v1/tenants')
          .set('authorization', `Bearer ${token}`)
          .send({
            name: 'Brand New Co',
            slug: `brand-new-${Math.random().toString(36).slice(2, 8)}`,
          });
        expect(res.status).toBe(201);
        expect(res.body.data.name).toBe('Brand New Co');
        expect(res.body.data.status).toBe('active');
      },
    );

    test.runIf(() => harness !== null)(
      'create rejects an invalid slug with 400 (zod validation branch)',
      async () => {
        if (harness === null) return;
        const { app } = harness;
        const { user, password } = await seedUser('super_admin', null);
        const token = await login(user.email, password);

        const res = await request(app)
          .post('/api/v1/tenants')
          .set('authorization', `Bearer ${token}`)
          .send({ name: 'Bad Slug Co', slug: 'not a valid slug!' });
        expect(res.status).toBe(400);
        expect(res.body.success).toBe(false);
        expect(res.body.details).toBeDefined();
      },
    );

    test.runIf(() => harness !== null)(
      'create rejects a missing required field with 400',
      async () => {
        if (harness === null) return;
        const { app } = harness;
        const { user, password } = await seedUser('super_admin', null);
        const token = await login(user.email, password);

        const res = await request(app)
          .post('/api/v1/tenants')
          .set('authorization', `Bearer ${token}`)
          .send({ slug: 'no-name-here' });
        expect(res.status).toBe(400);
      },
    );

    test.runIf(() => harness !== null)('create rejects a duplicate slug with 409', async () => {
      if (harness === null) return;
      const { app } = harness;
      const { user, password } = await seedUser('super_admin', null);
      const token = await login(user.email, password);
      const slug = `dupe-${Math.random().toString(36).slice(2, 8)}`;

      const first = await request(app)
        .post('/api/v1/tenants')
        .set('authorization', `Bearer ${token}`)
        .send({ name: 'First', slug });
      expect(first.status).toBe(201);

      const second = await request(app)
        .post('/api/v1/tenants')
        .set('authorization', `Bearer ${token}`)
        .send({ name: 'Second', slug });
      expect(second.status).toBe(409);
      expect(second.body.message).toMatch(/slug/i);
    });

    test.runIf(() => harness !== null)('get by id 404s for an unknown id', async () => {
      if (harness === null) return;
      const { app } = harness;
      const { user, password } = await seedUser('admin', null);
      const token = await login(user.email, password);

      const res = await request(app)
        .get('/api/v1/tenants/00000000-0000-4000-8000-000000000000')
        .set('authorization', `Bearer ${token}`);
      expect(res.status).toBe(404);
    });

    test.runIf(() => harness !== null)('get by id returns the tenant when it exists', async () => {
      if (harness === null) return;
      const { app } = harness;
      const tenant = await seedTenant();
      const { user, password } = await seedUser('admin', null);
      const token = await login(user.email, password);

      const res = await request(app)
        .get(`/api/v1/tenants/${tenant.id}`)
        .set('authorization', `Bearer ${token}`);
      expect(res.status).toBe(200);
      expect(res.body.data.id).toBe(tenant.id);
    });

    test.runIf(() => harness !== null)('update applies fields and persists them', async () => {
      if (harness === null) return;
      const { app } = harness;
      const tenant = await seedTenant();
      const { user, password } = await seedUser('super_admin', null);
      const token = await login(user.email, password);

      const res = await request(app)
        .patch(`/api/v1/tenants/${tenant.id}`)
        .set('authorization', `Bearer ${token}`)
        .send({ name: 'Updated Name', status: 'suspended' });
      expect(res.status).toBe(200);
      expect(res.body.data.name).toBe('Updated Name');
      expect(res.body.data.status).toBe('suspended');
    });

    test.runIf(() => harness !== null)('update 404s for an unknown id', async () => {
      if (harness === null) return;
      const { app } = harness;
      const { user, password } = await seedUser('super_admin', null);
      const token = await login(user.email, password);

      const res = await request(app)
        .patch('/api/v1/tenants/00000000-0000-4000-8000-000000000000')
        .set('authorization', `Bearer ${token}`)
        .send({ name: 'Ghost' });
      expect(res.status).toBe(404);
    });

    test.runIf(() => harness !== null)(
      'update rejects an invalid status enum with 400',
      async () => {
        if (harness === null) return;
        const { app } = harness;
        const tenant = await seedTenant();
        const { user, password } = await seedUser('super_admin', null);
        const token = await login(user.email, password);

        const res = await request(app)
          .patch(`/api/v1/tenants/${tenant.id}`)
          .set('authorization', `Bearer ${token}`)
          .send({ status: 'not-a-real-status' });
        expect(res.status).toBe(400);
      },
    );

    test.runIf(() => harness !== null)('delete soft-deletes the tenant, then 404s', async () => {
      if (harness === null) return;
      const { app } = harness;
      const tenant = await seedTenant();
      const { user, password } = await seedUser('super_admin', null);
      const token = await login(user.email, password);

      const del = await request(app)
        .delete(`/api/v1/tenants/${tenant.id}`)
        .set('authorization', `Bearer ${token}`);
      expect(del.status).toBe(200);
      expect(del.body.success).toBe(true);

      const after = await request(app)
        .get(`/api/v1/tenants/${tenant.id}`)
        .set('authorization', `Bearer ${token}`);
      expect(after.status).toBe(404);
    });

    test.runIf(() => harness !== null)('delete 404s for an unknown id', async () => {
      if (harness === null) return;
      const { app } = harness;
      const { user, password } = await seedUser('super_admin', null);
      const token = await login(user.email, password);

      const res = await request(app)
        .delete('/api/v1/tenants/00000000-0000-4000-8000-000000000000')
        .set('authorization', `Bearer ${token}`);
      expect(res.status).toBe(404);
    });

    test.runIf(() => harness !== null)(
      'rotate-embed-secret returns a fresh secret different from the original',
      async () => {
        if (harness === null) return;
        const { app } = harness;
        const tenant = await seedTenant();
        const originalSecret = tenant.embedSecret;
        const { user, password } = await seedUser('super_admin', null);
        const token = await login(user.email, password);

        const res = await request(app)
          .post(`/api/v1/tenants/${tenant.id}/rotate-embed-secret`)
          .set('authorization', `Bearer ${token}`);
        expect(res.status).toBe(200);
        expect(res.body.data.embedSecret).toBeTypeOf('string');
        expect(res.body.data.embedSecret).not.toBe(originalSecret);
      },
    );

    test.runIf(() => harness !== null)('rotate-embed-secret 404s for an unknown id', async () => {
      if (harness === null) return;
      const { app } = harness;
      const { user, password } = await seedUser('super_admin', null);
      const token = await login(user.email, password);

      const res = await request(app)
        .post('/api/v1/tenants/00000000-0000-4000-8000-000000000000/rotate-embed-secret')
        .set('authorization', `Bearer ${token}`);
      expect(res.status).toBe(404);
    });

    test.runIf(() => harness !== null)(
      'allowed-origins sets the list when given a valid array',
      async () => {
        if (harness === null) return;
        const { app } = harness;
        const tenant = await seedTenant();
        const { user, password } = await seedUser('super_admin', null);
        const token = await login(user.email, password);

        const res = await request(app)
          .put(`/api/v1/tenants/${tenant.id}/allowed-origins`)
          .set('authorization', `Bearer ${token}`)
          .send({ origins: ['https://example.com', 'https://foo.example.com'] });
        expect(res.status).toBe(200);
        expect(res.body.data.allowedOrigins).toEqual([
          'https://example.com',
          'https://foo.example.com',
        ]);
      },
    );

    test.runIf(() => harness !== null)(
      'allowed-origins clears to null when origins is not an array (branch coverage)',
      async () => {
        if (harness === null) return;
        const { app } = harness;
        const tenant = await seedTenant();
        const { user, password } = await seedUser('super_admin', null);
        const token = await login(user.email, password);

        const res = await request(app)
          .put(`/api/v1/tenants/${tenant.id}/allowed-origins`)
          .set('authorization', `Bearer ${token}`)
          .send({ origins: 'not-an-array' });
        expect(res.status).toBe(200);
        expect(res.body.data.allowedOrigins).toBeNull();
      },
    );

    test.runIf(() => harness !== null)('allowed-origins 404s for an unknown id', async () => {
      if (harness === null) return;
      const { app } = harness;
      const { user, password } = await seedUser('super_admin', null);
      const token = await login(user.email, password);

      const res = await request(app)
        .put('/api/v1/tenants/00000000-0000-4000-8000-000000000000/allowed-origins')
        .set('authorization', `Bearer ${token}`)
        .send({ origins: ['https://example.com'] });
      expect(res.status).toBe(404);
    });
  });

  describe('/users', () => {
    test.runIf(() => harness !== null)('list returns all users for an admin', async () => {
      if (harness === null) return;
      const { app } = harness;
      const { user, password } = await seedUser('admin', null);
      const token = await login(user.email, password);

      const res = await request(app).get('/api/v1/users').set('authorization', `Bearer ${token}`);
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.data.length).toBeGreaterThan(0);
      expect(res.body.data[0].passwordHash).toBeUndefined();
    });

    test.runIf(() => harness !== null)('list filters by tenantId query when provided', async () => {
      if (harness === null) return;
      const { app } = harness;
      const tenantA = await seedTenant();
      const tenantB = await seedTenant();
      await seedUser('client', tenantA.id);
      await seedUser('client', tenantB.id);
      const { user: admin, password } = await seedUser('admin', null);
      const token = await login(admin.email, password);

      const res = await request(app)
        .get(`/api/v1/users?tenantId=${tenantA.id}`)
        .set('authorization', `Bearer ${token}`);
      expect(res.status).toBe(200);
      expect(res.body.data.length).toBeGreaterThan(0);
      for (const returned of res.body.data as { tenantId: string | null }[]) {
        expect(returned.tenantId).toBe(tenantA.id);
      }
    });

    test.runIf(() => harness !== null)('get by id 404s for an unknown id', async () => {
      if (harness === null) return;
      const { app } = harness;
      const { user, password } = await seedUser('admin', null);
      const token = await login(user.email, password);

      const res = await request(app)
        .get('/api/v1/users/00000000-0000-4000-8000-000000000000')
        .set('authorization', `Bearer ${token}`);
      expect(res.status).toBe(404);
    });

    test.runIf(() => harness !== null)('get by id returns the user when it exists', async () => {
      if (harness === null) return;
      const { app } = harness;
      const { user: target } = await seedUser('client', null);
      const { user: admin, password } = await seedUser('admin', null);
      const token = await login(admin.email, password);

      const res = await request(app)
        .get(`/api/v1/users/${target.id}`)
        .set('authorization', `Bearer ${token}`);
      expect(res.status).toBe(200);
      expect(res.body.data.id).toBe(target.id);
      expect(res.body.data.passwordHash).toBeUndefined();
    });

    test.runIf(() => harness !== null)('update applies fields and persists them', async () => {
      if (harness === null) return;
      const { app } = harness;
      const { user: target } = await seedUser('client', null);
      const { user: admin, password } = await seedUser('admin', null);
      const token = await login(admin.email, password);

      const res = await request(app)
        .patch(`/api/v1/users/${target.id}`)
        .set('authorization', `Bearer ${token}`)
        .send({ firstName: 'Renamed', status: 'suspended' });
      expect(res.status).toBe(200);
      expect(res.body.data.firstName).toBe('Renamed');
      expect(res.body.data.status).toBe('suspended');
    });

    test.runIf(() => harness !== null)('update 404s for an unknown id', async () => {
      if (harness === null) return;
      const { app } = harness;
      const { user, password } = await seedUser('admin', null);
      const token = await login(user.email, password);

      const res = await request(app)
        .patch('/api/v1/users/00000000-0000-4000-8000-000000000000')
        .set('authorization', `Bearer ${token}`)
        .send({ firstName: 'Ghost' });
      expect(res.status).toBe(404);
    });

    test.runIf(() => harness !== null)(
      'update rejects an invalid role enum with 400 (zod branch)',
      async () => {
        if (harness === null) return;
        const { app } = harness;
        const { user: target } = await seedUser('client', null);
        const { user: admin, password } = await seedUser('admin', null);
        const token = await login(admin.email, password);

        const res = await request(app)
          .patch(`/api/v1/users/${target.id}`)
          .set('authorization', `Bearer ${token}`)
          .send({ role: 'not-a-real-role' });
        expect(res.status).toBe(400);
      },
    );

    test.runIf(() => harness !== null)(
      'update rejects an invalid status enum with 400 (zod branch)',
      async () => {
        if (harness === null) return;
        const { app } = harness;
        const { user: target } = await seedUser('client', null);
        const { user: admin, password } = await seedUser('admin', null);
        const token = await login(admin.email, password);

        const res = await request(app)
          .patch(`/api/v1/users/${target.id}`)
          .set('authorization', `Bearer ${token}`)
          .send({ status: 'not-a-real-status' });
        expect(res.status).toBe(400);
      },
    );
  });

  // Issue #43: role alone never granted cross-tenant access. A caller carrying
  // a tenant_id is confined to it; only untenanted AFixt staff span tenants.
  test.runIf(() => harness !== null)(
    "a tenant-scoped admin cannot read or modify another tenant's user",
    async () => {
      if (harness === null) return;
      const { app } = harness;
      const own = await seedTenant({ slug: `iso-own-${Math.random().toString(36).slice(2, 8)}` });
      const other = await seedTenant({
        slug: `iso-other-${Math.random().toString(36).slice(2, 8)}`,
      });
      const admin = await seedUser('admin', own.id);
      const victim = await seedUser('staff', other.id);
      const token = await login(admin.user.email, admin.password);
      const auth = `Bearer ${token}`;

      const read = await request(app)
        .get(`/api/v1/users/${victim.user.id}`)
        .set('authorization', auth);
      expect(read.status).toBe(403);

      const write = await request(app)
        .patch(`/api/v1/users/${victim.user.id}`)
        .set('authorization', auth)
        .send({ status: 'suspended' });
      expect(write.status).toBe(403);

      // The victim must be untouched by the refused write.
      await victim.user.reload();
      expect(victim.user.status).toBe('active');
    },
  );

  test.runIf(() => harness !== null)(
    'list endpoints are pinned to the caller tenant and refuse a cross-tenant filter',
    async () => {
      if (harness === null) return;
      const { app } = harness;
      const own = await seedTenant({ slug: `pin-own-${Math.random().toString(36).slice(2, 8)}` });
      const other = await seedTenant({
        slug: `pin-other-${Math.random().toString(36).slice(2, 8)}`,
      });
      const admin = await seedUser('admin', own.id);
      const outsider = await seedUser('staff', other.id);
      const token = await login(admin.user.email, admin.password);
      const auth = `Bearer ${token}`;

      const users = await request(app).get('/api/v1/users').set('authorization', auth);
      expect(users.status).toBe(200);
      const userIds = (users.body.data as { id: string }[]).map((u) => u.id);
      expect(userIds).toContain(admin.user.id);
      expect(userIds).not.toContain(outsider.user.id);

      const crossFilter = await request(app)
        .get('/api/v1/users')
        .query({ tenantId: other.id })
        .set('authorization', auth);
      expect(crossFilter.status).toBe(403);

      const tenants = await request(app).get('/api/v1/tenants').set('authorization', auth);
      expect(tenants.status).toBe(200);
      const tenantIds = (tenants.body.data as { id: string }[]).map((t) => t.id);
      expect(tenantIds).toEqual([own.id]);
    },
  );

  test.runIf(() => harness !== null)('untenanted AFixt staff still span every tenant', async () => {
    if (harness === null) return;
    const { app } = harness;
    const a = await seedTenant({ slug: `span-a-${Math.random().toString(36).slice(2, 8)}` });
    const b = await seedTenant({ slug: `span-b-${Math.random().toString(36).slice(2, 8)}` });
    const su = await seedUser('super_admin', null);
    const token = await login(su.user.email, su.password);
    const auth = `Bearer ${token}`;

    const readA = await request(app).get(`/api/v1/tenants/${a.id}`).set('authorization', auth);
    expect(readA.status).toBe(200);
    const readB = await request(app).get(`/api/v1/tenants/${b.id}`).set('authorization', auth);
    expect(readB.status).toBe(200);

    const filtered = await request(app)
      .get('/api/v1/users')
      .query({ tenantId: b.id })
      .set('authorization', auth);
    expect(filtered.status).toBe(200);
  });
});
