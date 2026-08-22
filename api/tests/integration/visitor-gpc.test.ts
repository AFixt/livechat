import request from 'supertest';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';

import { AuditLog, ConsentRecord, Tenant, VisitorSession } from '../../src/models/index.js';

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
    name: `GPC ${slug}`,
    slug,
    status: 'active',
    domain: null,
    expiresAt: null,
    settings: null,
  });
}

/**
 * Assert a GPC-sourced consent record with a denied non-essential state exists
 * for a tenant, and that the honored opt-out was audited.
 * @param tenantId - The tenant id.
 */
async function expectHonoredGpc(tenantId: string): Promise<void> {
  const record = await ConsentRecord.findOne({ where: { tenantId, source: 'gpc' } });
  expect(record).not.toBeNull();
  expect(record?.gpc).toBe(true);
  expect(record?.legalBasis).toBe('opt_out');
  expect(record?.purposes.presence).toBe('denied');
  expect(record?.purposes.analytics).toBe('denied');

  const detected = await AuditLog.findOne({
    where: { action: 'privacy.gpc_detected', resourceId: record?.id ?? '' },
  });
  expect(detected).not.toBeNull();
  const applied = await AuditLog.findOne({
    where: { action: 'privacy.gpc_applied', resourceId: record?.id ?? '' },
  });
  expect(applied).not.toBeNull();
}

describe('GPC universal opt-out (integration)', () => {
  beforeAll(async () => {
    harness = await probeHarness();
    if (harness === null) console.warn('[integration] MySQL or Redis not reachable — skipping');
  }, 60_000);

  afterAll(async () => {
    if (harness !== null) await harness.cleanup();
  });

  test('Sec-GPC header suppresses tracking even in an opt-out jurisdiction', async () => {
    if (harness === null) return;
    const { app } = harness;
    const tenant = await seedTenant(`hdr-${Math.random().toString(36).slice(2, 8)}`);

    const res = await request(app)
      .post('/api/v1/visitor/session')
      .set('Sec-GPC', '1')
      .set('x-geo-country', 'US')
      .send({ tenantKey: tenant.slug, currentUrl: 'https://us.example/x' });
    expect(res.status).toBe(201);
    expect(res.body.data.gpc).toBe(true);
    expect(res.body.data.sessionId).toBeNull();
    expect(res.body.data.tracking.presence).toBe('denied');

    expect(await VisitorSession.count({ where: { tenantId: tenant.id } })).toBe(0);
    await expectHonoredGpc(tenant.id);
  });

  test('the widget GPC signal (body flag) suppresses tracking too', async () => {
    if (harness === null) return;
    const { app } = harness;
    const tenant = await seedTenant(`sig-${Math.random().toString(36).slice(2, 8)}`);

    const res = await request(app)
      .post('/api/v1/visitor/session')
      .set('x-geo-country', 'US')
      .send({ tenantKey: tenant.slug, gpc: true });
    expect(res.status).toBe(201);
    expect(res.body.data.gpc).toBe(true);
    expect(res.body.data.sessionId).toBeNull();

    expect(await VisitorSession.count({ where: { tenantId: tenant.id } })).toBe(0);
    await expectHonoredGpc(tenant.id);
  });

  test('GPC stops ambient tracking for an already-tracked returning visitor', async () => {
    if (harness === null) return;
    const { app } = harness;
    const agent = request.agent(app);
    const tenant = await seedTenant(`ret-${Math.random().toString(36).slice(2, 8)}`);

    // First visit without GPC in an opt-out jurisdiction → tracked.
    const tracked = await agent
      .post('/api/v1/visitor/session')
      .set('x-geo-country', 'US')
      .send({ tenantKey: tenant.slug });
    expect(tracked.body.data.sessionId).not.toBeNull();
    expect(await VisitorSession.count({ where: { tenantId: tenant.id } })).toBe(1);

    // A later page load presents GPC → tracking is no longer returned/refreshed.
    const gpc = await agent
      .post('/api/v1/visitor/session')
      .set('Sec-GPC', '1')
      .set('x-geo-country', 'US')
      .send({ tenantKey: tenant.slug });
    expect(gpc.body.data.sessionId).toBeNull();
    expect(gpc.body.data.tracking.presence).toBe('denied');
    await expectHonoredGpc(tenant.id);
  });
});
