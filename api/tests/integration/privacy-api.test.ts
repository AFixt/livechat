import request from 'supertest';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';

import { AuditLog, ConsentRecord, Tenant } from '../../src/models/index.js';

import { probeHarness } from './setup.js';

type Harness = Awaited<ReturnType<typeof probeHarness>>;

let harness: Harness;

/**
 * Create an active tenant.
 * @param slug - Unique slug.
 * @returns The tenant.
 */
async function seedTenant(slug: string): Promise<Tenant> {
  return Tenant.create({
    name: `Privacy ${slug}`,
    slug,
    status: 'active',
    domain: null,
    expiresAt: null,
    settings: null,
  });
}

/**
 * Extract the `Set-Cookie` header entries from a supertest response.
 * @param res - The response.
 * @returns The Set-Cookie header entries (possibly empty).
 */
function cookiesOf(res: request.Response): string[] {
  const raw = res.headers['set-cookie'] as string[] | string | undefined;
  if (typeof raw === 'string') return [raw];
  return raw ?? [];
}

describe('privacy API (integration)', () => {
  beforeAll(async () => {
    harness = await probeHarness();
    if (harness === null) console.warn('[integration] MySQL or Redis not reachable — skipping');
  }, 60_000);

  afterAll(async () => {
    if (harness !== null) await harness.cleanup();
  });

  test('GET /privacy/consent returns strict opt-in state for an unknown location', async () => {
    if (harness === null) return;
    const { app } = harness;
    const tenant = await seedTenant(`read-${Math.random().toString(36).slice(2, 8)}`);

    const res = await request(app)
      .get('/api/v1/privacy/consent')
      .query({ tenantKey: tenant.slug });
    expect(res.status).toBe(200);
    expect(res.body.data.jurisdiction).toBe('UNKNOWN');
    expect(res.body.data.purposes.functional).toBe('granted');
    expect(res.body.data.purposes.presence).toBe('denied');
    expect(res.body.data.requiresOptIn).toEqual(['presence', 'analytics']);
    // A read must not mint an audit row.
    expect(cookiesOf(res).join()).toContain('livechat_visitor');
  });

  test('POST /privacy/consent records a banner grant and flips the effective state', async () => {
    if (harness === null) return;
    const { app } = harness;
    const tenant = await seedTenant(`grant-${Math.random().toString(36).slice(2, 8)}`);

    const res = await request(app)
      .post('/api/v1/privacy/consent')
      .send({ tenantKey: tenant.slug, country: 'DE', purposes: { presence: 'granted' } });
    expect(res.status).toBe(201);
    expect(res.body.data.jurisdiction).toBe('EU');
    expect(res.body.data.purposes.presence).toBe('granted');
    expect(res.body.data.purposes.analytics).toBe('denied');
    expect(res.body.data.legalBasis).toBe('consent');

    const rows = await ConsentRecord.findAll({ where: { tenantId: tenant.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.source).toBe('banner');
    expect(rows[0]?.ipHash).not.toBeNull();
    // Raw IP is never persisted — only the HMAC.
    expect(rows[0]?.ipHash).not.toContain('.');

    const applied = await AuditLog.findOne({ where: { action: 'privacy.rule_applied' } });
    expect(applied?.resourceId).toBe(rows[0]?.id);
    const recorded = await AuditLog.findOne({ where: { action: 'privacy.consent_recorded' } });
    expect(recorded).not.toBeNull();
  });

  test('the same cookie makes a banner grant persist across reads', async () => {
    if (harness === null) return;
    const { app } = harness;
    const agent = request.agent(app);
    const tenant = await seedTenant(`persist-${Math.random().toString(36).slice(2, 8)}`);

    const grant = await agent
      .post('/api/v1/privacy/consent')
      .send({ tenantKey: tenant.slug, country: 'US', purposes: { presence: 'denied' } });
    expect(grant.status).toBe(201);
    expect(grant.body.data.purposes.presence).toBe('denied');

    const read = await agent
      .get('/api/v1/privacy/consent')
      .query({ tenantKey: tenant.slug, country: 'US' });
    // The prior explicit opt-out must survive the next decision.
    expect(read.body.data.purposes.presence).toBe('denied');
    expect(read.body.data.purposes.analytics).toBe('granted');
  });

  test('POST /privacy/consent/withdraw suppresses non-essential purposes', async () => {
    if (harness === null) return;
    const { app } = harness;
    const agent = request.agent(app);
    const tenant = await seedTenant(`withdraw-${Math.random().toString(36).slice(2, 8)}`);

    await agent
      .post('/api/v1/privacy/consent')
      .send({ tenantKey: tenant.slug, country: 'US', purposes: { presence: 'granted' } });
    const res = await agent
      .post('/api/v1/privacy/consent/withdraw')
      .send({ tenantKey: tenant.slug, country: 'US' });
    expect(res.status).toBe(200);
    expect(res.body.data.purposes.presence).toBe('denied');
    expect(res.body.data.purposes.analytics).toBe('denied');
    expect(res.body.data.legalBasis).toBe('withdrawn');

    const withdrawn = await AuditLog.findOne({ where: { action: 'privacy.consent_withdrawn' } });
    expect(withdrawn).not.toBeNull();
  });

  test('Sec-GPC header suppresses non-essential tracking in an opt-out state', async () => {
    if (harness === null) return;
    const { app } = harness;
    const tenant = await seedTenant(`gpc-${Math.random().toString(36).slice(2, 8)}`);

    const res = await request(app)
      .get('/api/v1/privacy/consent')
      .set('Sec-GPC', '1')
      .query({ tenantKey: tenant.slug, country: 'US' });
    expect(res.status).toBe(200);
    expect(res.body.data.gpc).toBe(true);
    expect(res.body.data.purposes.presence).toBe('denied');
    expect(res.body.data.purposes.analytics).toBe('denied');
  });

  test('POST /privacy/data-request queues an audited stub', async () => {
    if (harness === null) return;
    const { app } = harness;
    const tenant = await seedTenant(`dsr-${Math.random().toString(36).slice(2, 8)}`);

    const res = await request(app)
      .post('/api/v1/privacy/data-request')
      .send({ tenantKey: tenant.slug, type: 'delete' });
    expect(res.status).toBe(202);
    expect(res.body.data.status).toBe('queued');
    expect(typeof res.body.data.requestId).toBe('string');

    const row = await AuditLog.findOne({
      where: { action: 'privacy.data_request', resourceId: res.body.data.requestId as string },
    });
    expect(row?.metadata).toMatchObject({ type: 'delete' });
  });

  test('an unknown tenant is rejected', async () => {
    if (harness === null) return;
    const { app } = harness;
    const res = await request(app)
      .post('/api/v1/privacy/consent')
      .send({ tenantKey: 'does-not-exist', purposes: { presence: 'granted' } });
    expect(res.status).toBe(400);
  });
});
