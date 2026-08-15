import request from 'supertest';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';

import { ConsentRecord, Tenant, VisitorSession } from '../../src/models/index.js';

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
    name: `Gate ${slug}`,
    slug,
    status: 'active',
    domain: null,
    expiresAt: null,
    settings: null,
  });
}

/**
 * Count tracked `visitor_sessions` rows for a tenant.
 * @param tenantId - The tenant.
 * @returns The row count.
 */
async function sessionCount(tenantId: string): Promise<number> {
  return VisitorSession.count({ where: { tenantId } });
}

describe('visitor consent gate (integration)', () => {
  beforeAll(async () => {
    harness = await probeHarness();
    if (harness === null) console.warn('[integration] MySQL or Redis not reachable — skipping');
  }, 60_000);

  afterAll(async () => {
    if (harness !== null) await harness.cleanup();
  });

  test('opt-in visitor is not tracked on page load', async () => {
    if (harness === null) return;
    const { app } = harness;
    const tenant = await seedTenant(`optin-${Math.random().toString(36).slice(2, 8)}`);

    const res = await request(app)
      .post('/api/v1/visitor/session')
      .send({ tenantKey: tenant.slug, country: 'DE', currentUrl: 'https://shop.example/p/1' });
    expect(res.status).toBe(201);
    expect(res.body.data.sessionId).toBeNull();
    expect(res.body.data.jurisdiction).toBe('EU');
    expect(res.body.data.tracking.presence).toBe('denied');

    // No behavioral row exists — but the decision was still audited.
    expect(await sessionCount(tenant.id)).toBe(0);
    expect(await ConsentRecord.count({ where: { tenantId: tenant.id } })).toBe(1);
  });

  test('tracking begins once the opt-in visitor consents', async () => {
    if (harness === null) return;
    const { app } = harness;
    const agent = request.agent(app);
    const tenant = await seedTenant(`consent-${Math.random().toString(36).slice(2, 8)}`);

    const gated = await agent
      .post('/api/v1/visitor/session')
      .send({ tenantKey: tenant.slug, country: 'DE' });
    expect(gated.body.data.sessionId).toBeNull();
    expect(await sessionCount(tenant.id)).toBe(0);

    // Visitor grants presence via the banner API (same cookie via the agent).
    const consent = await agent
      .post('/api/v1/privacy/consent')
      .send({ tenantKey: tenant.slug, country: 'DE', purposes: { presence: 'granted' } });
    expect(consent.body.data.purposes.presence).toBe('granted');

    // Re-running the gate now creates the tracked session.
    const tracked = await agent
      .post('/api/v1/visitor/session')
      .send({ tenantKey: tenant.slug, country: 'DE' });
    expect(tracked.body.data.sessionId).not.toBeNull();
    expect(tracked.body.data.tracking.presence).toBe('granted');
    expect(await sessionCount(tenant.id)).toBe(1);
  });

  test('opt-out visitor is tracked by default', async () => {
    if (harness === null) return;
    const { app } = harness;
    const tenant = await seedTenant(`optout-${Math.random().toString(36).slice(2, 8)}`);

    const res = await request(app)
      .post('/api/v1/visitor/session')
      .send({ tenantKey: tenant.slug, country: 'US', currentUrl: 'https://us.example/home' });
    expect(res.status).toBe(201);
    expect(res.body.data.sessionId).not.toBeNull();
    expect(res.body.data.jurisdiction).toBe('US');
    expect(res.body.data.tracking.presence).toBe('granted');

    const row = await VisitorSession.findByPk(res.body.data.sessionId as string);
    expect(row?.currentUrl).toBe('https://us.example/home');
    expect(row?.country).toBe('US');
  });

  test('opt-out visitor who opts out first is not tracked', async () => {
    if (harness === null) return;
    const { app } = harness;
    const agent = request.agent(app);
    const tenant = await seedTenant(`usopt-${Math.random().toString(36).slice(2, 8)}`);

    const opt = await agent
      .post('/api/v1/privacy/consent')
      .send({ tenantKey: tenant.slug, country: 'US', purposes: { presence: 'denied' } });
    expect(opt.body.data.purposes.presence).toBe('denied');

    const res = await agent
      .post('/api/v1/visitor/session')
      .send({ tenantKey: tenant.slug, country: 'US' });
    expect(res.body.data.sessionId).toBeNull();
    expect(await sessionCount(tenant.id)).toBe(0);
  });

  test('a consent-gated visitor can still start a chat (session created lazily)', async () => {
    if (harness === null) return;
    const { app } = harness;
    const agent = request.agent(app);
    const tenant = await seedTenant(`chat-${Math.random().toString(36).slice(2, 8)}`);

    const gated = await agent
      .post('/api/v1/visitor/session')
      .send({ tenantKey: tenant.slug, country: 'DE' });
    expect(gated.body.data.sessionId).toBeNull();
    expect(await sessionCount(tenant.id)).toBe(0);

    const chat = await agent
      .post('/api/v1/visitor/chats')
      .send({ customerName: 'Ada', body: 'Hello, I need help.' });
    expect(chat.status).toBe(201);
    expect(chat.body.data.chat.id).toBeTruthy();
    // Opening a chat is strictly necessary — the session row is created now.
    expect(await sessionCount(tenant.id)).toBe(1);
  });
});
