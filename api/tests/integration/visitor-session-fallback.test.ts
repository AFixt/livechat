import request from 'supertest';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';

import { Tenant } from '../../src/models/index.js';

import { probeHarness } from './setup.js';

type Harness = Awaited<ReturnType<typeof probeHarness>>;

const TENANT_SLUG = 'fallback-t';

describe('visitor session header fallback (#75)', () => {
  let harness: Harness;

  beforeAll(async () => {
    harness = await probeHarness();
    if (harness === null) {
      console.warn('[integration] MySQL or Redis not reachable — skipping');
      return;
    }
    await Tenant.create({
      name: 'Tenant-fallback',
      slug: TENANT_SLUG,
      status: 'active',
      domain: null,
      expiresAt: null,
      settings: null,
    });
  }, 60_000);

  afterAll(async () => {
    if (harness !== null) await harness.cleanup();
  });

  test('bootstrap returns a sessionToken for the header fallback', async () => {
    if (harness === null) return;
    const res = await request(harness.app)
      .post('/api/v1/visitor/session')
      .send({ tenantKey: TENANT_SLUG });
    expect(res.status).toBe(201);
    expect(typeof res.body.data.sessionToken).toBe('string');
  });

  test('authenticates from X-Visitor-Session with no cookie (third-party-cookie block)', async () => {
    if (harness === null) return;
    const boot = await request(harness.app)
      .post('/api/v1/visitor/session')
      .send({ tenantKey: TENANT_SLUG });
    const sessionToken = boot.body.data.sessionToken as string;

    // No Cookie header at all — exactly the Safari/Firefox third-party-cookie
    // situation. The session must still resolve from the header.
    const res = await request(harness.app)
      .get('/api/v1/visitor/chats/current')
      .set('X-Visitor-Session', sessionToken);

    expect(res.status).toBe(200);
    expect(res.body.data.chat).toBeNull();
    // The token is echoed back so a returning visitor can re-persist it.
    expect(res.body.data.sessionToken).toBe(sessionToken);
  });

  test('a write route accepts the header session plus the CSRF token', async () => {
    if (harness === null) return;
    const boot = await request(harness.app)
      .post('/api/v1/visitor/session')
      .send({ tenantKey: TENANT_SLUG });
    const sessionToken = boot.body.data.sessionToken as string;
    const csrfToken = boot.body.data.csrfToken as string;

    const res = await request(harness.app)
      .post('/api/v1/visitor/chats')
      .set('X-Visitor-Session', sessionToken)
      .set('X-XSRF-TOKEN', csrfToken)
      .send({ customerName: 'Header Visitor', body: 'hi over header' });

    expect(res.status).toBe(201);
  });

  test('the header path is still CSRF-gated on writes', async () => {
    if (harness === null) return;
    const boot = await request(harness.app)
      .post('/api/v1/visitor/session')
      .send({ tenantKey: TENANT_SLUG });
    const sessionToken = boot.body.data.sessionToken as string;

    const res = await request(harness.app)
      .post('/api/v1/visitor/chats')
      .set('X-Visitor-Session', sessionToken)
      .send({ customerName: 'No CSRF', body: 'should be refused' });

    expect(res.status).toBe(403);
  });

  test('a forged session header is rejected, not trusted', async () => {
    if (harness === null) return;
    const res = await request(harness.app)
      .get('/api/v1/visitor/chats/current')
      .set('X-Visitor-Session', 'not-a-real.signed-value');
    expect(res.status).toBe(401);
  });
});
