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
      .set('x-geo-country', 'DE')
      .send({ tenantKey: tenant.slug, currentUrl: 'https://shop.example/p/1' });
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
      .set('x-geo-country', 'DE')
      .send({ tenantKey: tenant.slug });
    expect(gated.body.data.sessionId).toBeNull();
    expect(await sessionCount(tenant.id)).toBe(0);

    // Visitor grants presence via the banner API (same cookie via the agent).
    const consent = await agent
      .post('/api/v1/privacy/consent')
      .set('x-geo-country', 'DE')
      .send({ tenantKey: tenant.slug, purposes: { presence: 'granted' } });
    expect(consent.body.data.purposes.presence).toBe('granted');

    // Re-running the gate now creates the tracked session.
    const tracked = await agent
      .post('/api/v1/visitor/session')
      .set('x-geo-country', 'DE')
      .send({ tenantKey: tenant.slug });
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
      .set('x-geo-country', 'US')
      .send({ tenantKey: tenant.slug, currentUrl: 'https://us.example/home' });
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
      .set('x-geo-country', 'US')
      .send({ tenantKey: tenant.slug, purposes: { presence: 'denied' } });
    expect(opt.body.data.purposes.presence).toBe('denied');

    const res = await agent
      .post('/api/v1/visitor/session')
      .set('x-geo-country', 'US')
      .send({ tenantKey: tenant.slug });
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
      .set('x-geo-country', 'DE')
      .send({ tenantKey: tenant.slug });
    expect(gated.body.data.sessionId).toBeNull();
    expect(await sessionCount(tenant.id)).toBe(0);

    // Starting a chat is a CSRF-protected write (#77): the gate must issue a
    // token even when it suppressed tracking, or a gated visitor could never
    // open a chat at all.
    const csrfToken = gated.body.data.csrfToken as string;
    expect(csrfToken).toBeTruthy();
    const chat = await agent
      .post('/api/v1/visitor/chats')
      .set('X-XSRF-TOKEN', csrfToken)
      .send({ customerName: 'Ada', body: 'Hello, I need help.' });
    expect(chat.status).toBe(201);
    expect(chat.body.data.chat.id).toBeTruthy();
    // Opening a chat is strictly necessary — the session row is created now.
    expect(await sessionCount(tenant.id)).toBe(1);
  });
  test('withdrawing consent stops presence tracking, not just records it', async () => {
    if (harness === null) return;
    const { app } = harness;
    const agent = request.agent(app);
    const tenant = await seedTenant(`withdraw-${Math.random().toString(36).slice(2, 8)}`);

    // A US visitor is tracked by default (opt-out regime).
    const tracked = await agent
      .post('/api/v1/visitor/session')
      .set('x-geo-country', 'US')
      .send({ tenantKey: tenant.slug, currentUrl: 'https://us.example/a' });
    expect(tracked.body.data.sessionId).not.toBeNull();
    expect(await sessionCount(tenant.id)).toBe(1);

    // Withdrawing must actually delete the behavioral row. Recording the
    // withdrawal while leaving the row in place would keep retaining (and
    // heartbeating) the visitor's IP/UA/current URL after they opted out.
    const withdrawn = await agent
      .post('/api/v1/privacy/consent/withdraw')
      .set('x-geo-country', 'US')
      .send({ tenantKey: tenant.slug });
    expect(withdrawn.status).toBe(200);
    expect(withdrawn.body.data.purposes.presence).toBe('denied');
    expect(await sessionCount(tenant.id)).toBe(0);

    // And a later page load must not silently resume tracking.
    const after = await agent
      .post('/api/v1/visitor/session')
      .set('x-geo-country', 'US')
      .send({ tenantKey: tenant.slug, currentUrl: 'https://us.example/b' });
    expect(after.body.data.sessionId).toBeNull();
    expect(await sessionCount(tenant.id)).toBe(0);
  });

  test('an unchanged page load does not append consent or audit rows', async () => {
    if (harness === null) return;
    const { app } = harness;
    const agent = request.agent(app);
    const tenant = await seedTenant(`repeat-${Math.random().toString(36).slice(2, 8)}`);

    const first = await agent
      .post('/api/v1/visitor/session')
      .set('x-geo-country', 'US')
      .send({ tenantKey: tenant.slug, currentUrl: 'https://us.example/1' });
    expect(first.status).toBe(201);
    const afterFirst = await ConsentRecord.count({ where: { tenantId: tenant.id } });
    expect(afterFirst).toBe(1);

    // Two more page views with an identical decision. The consent trail records
    // decisions and changes, not impressions — otherwise every visitor would
    // append a record plus a batch of audit rows on every page they open.
    for (const url of ['https://us.example/2', 'https://us.example/3']) {
      const again = await agent
        .post('/api/v1/visitor/session')
        .set('x-geo-country', 'US')
        .send({ tenantKey: tenant.slug, currentUrl: url });
      expect(again.status).toBe(201);
      expect(again.body.data.tracking.presence).toBe('granted');
    }
    expect(await ConsentRecord.count({ where: { tenantId: tenant.id } })).toBe(afterFirst);

    // A real change (GPC appearing) is still recorded, and still enforced.
    const gpc = await agent
      .post('/api/v1/visitor/session')
      .set('Sec-GPC', '1')
      .set('x-geo-country', 'US')
      .send({ tenantKey: tenant.slug });
    expect(gpc.body.data.tracking.presence).toBe('denied');
    expect(await ConsentRecord.count({ where: { tenantId: tenant.id } })).toBe(afterFirst + 1);
  });

  test('a country in the request body cannot widen the jurisdiction', async () => {
    if (harness === null) return;
    const { app } = harness;
    const tenant = await seedTenant(`spoof-${Math.random().toString(36).slice(2, 8)}`);

    // The widget runs on the client's own site, so anything in the body is
    // attacker- or misconfiguration-controlled. Claiming `US` must not turn an
    // opt-in jurisdiction into an opt-out one: with no trusted edge header the
    // visitor stays UNKNOWN, which denies presence.
    const spoofed = await request(app)
      .post('/api/v1/visitor/session')
      .send({ tenantKey: tenant.slug, country: 'US', region: 'CA' });
    expect(spoofed.status).toBe(201);
    expect(spoofed.body.data.jurisdiction).toBe('UNKNOWN');
    expect(spoofed.body.data.tracking.presence).toBe('denied');
    expect(spoofed.body.data.sessionId).toBeNull();
    expect(await sessionCount(tenant.id)).toBe(0);

    // Control: the same value from the trusted edge header *is* honored, so
    // this test fails if jurisdiction resolution stops working altogether
    // rather than merely ignoring the body.
    const trusted = await request(app)
      .post('/api/v1/visitor/session')
      .set('x-geo-country', 'US')
      .send({ tenantKey: tenant.slug });
    expect(trusted.body.data.jurisdiction).toBe('US');
    expect(trusted.body.data.tracking.presence).toBe('granted');
    expect(trusted.body.data.sessionId).not.toBeNull();
  });

  test('the gate issues a CSRF token on every page load', async () => {
    if (harness === null) return;
    const { app } = harness;
    const tenant = await seedTenant(`csrf-${Math.random().toString(36).slice(2, 8)}`);

    // Gated (untracked) and tracked visitors alike need the token, since both
    // can perform CSRF-protected writes.
    for (const country of ['DE', 'US']) {
      const res = await request(app)
        .post('/api/v1/visitor/session')
        .set('x-geo-country', country)
        .send({ tenantKey: tenant.slug });
      expect(res.status).toBe(201);
      expect(typeof res.body.data.csrfToken).toBe('string');
      expect((res.body.data.csrfToken as string).length).toBeGreaterThan(0);
    }
  });
});
