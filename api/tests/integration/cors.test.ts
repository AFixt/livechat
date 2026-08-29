import request from 'supertest';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';

import { clearOriginCache } from '../../src/middlewares/cors.js';
import { Tenant } from '../../src/models/index.js';

import { integrationDbUp, probeHarness } from './setup.js';

type Harness = Awaited<ReturnType<typeof probeHarness>>;

const ALLOWED_ORIGIN = 'https://embed.acme.example';
const UNKNOWN_ORIGIN = 'https://evil.example';

/**
 * Seed a tenant with an explicit allowed-origins list.
 * @param slug - Tenant slug.
 * @param allowedOrigins - Origins to authorize, or null for none.
 * @returns The created tenant id.
 */
async function seedTenant(slug: string, allowedOrigins: string[] | null): Promise<string> {
  const tenant = await Tenant.create({
    name: `Tenant-${slug}`,
    slug,
    status: 'active',
    domain: null,
    expiresAt: null,
    settings: null,
    allowedOrigins,
  });
  return tenant.id;
}

describe.skipIf(!integrationDbUp)('per-tenant CORS (#74)', () => {
  let harness: Harness;

  beforeAll(async () => {
    harness = await probeHarness();
    if (harness === null) {
      console.warn('[integration] MySQL or Redis not reachable — skipping');
      return;
    }
    await seedTenant('cors-acme', [ALLOWED_ORIGIN]);
    await seedTenant('cors-bare', null);
    clearOriginCache();
  }, 60_000);

  afterAll(async () => {
    if (harness !== null) await harness.cleanup();
  });

  test('reflects a tenant-allowed origin on a widget-facing route, with Vary: Origin', async () => {
    if (harness === null) return;
    const res = await request(harness.app)
      .post('/api/v1/visitor/session')
      .set('Origin', ALLOWED_ORIGIN)
      .send({ tenantKey: 'cors-acme' });

    expect(res.headers['access-control-allow-origin']).toBe(ALLOWED_ORIGIN);
    expect(res.headers['access-control-allow-credentials']).toBe('true');
    expect(res.headers['vary'] ?? '').toContain('Origin');
  });

  test('answers a preflight for an allowed origin', async () => {
    if (harness === null) return;
    const res = await request(harness.app)
      .options('/api/v1/visitor/session')
      .set('Origin', ALLOWED_ORIGIN)
      .set('Access-Control-Request-Method', 'POST');

    expect(res.status).toBeLessThan(300);
    expect(res.headers['access-control-allow-origin']).toBe(ALLOWED_ORIGIN);
  });

  test('does not reflect an origin no tenant has allowed (default-deny)', async () => {
    if (harness === null) return;
    const res = await request(harness.app)
      .post('/api/v1/visitor/session')
      .set('Origin', UNKNOWN_ORIGIN)
      .send({ tenantKey: 'cors-bare' });

    // No ACAO header → the browser blocks the credentialed response.
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  test('console routes keep the strict APP_URL policy', async () => {
    if (harness === null) return;
    // /health is not widget-facing: even a would-be widget origin gets the
    // fixed console origin back, never reflected.
    const res = await request(harness.app).get('/api/v1/health').set('Origin', ALLOWED_ORIGIN);

    expect(res.headers['access-control-allow-origin']).toBe(harness.env.APP_URL);
  });
});
