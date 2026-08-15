import request from 'supertest';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';

import { Tenant } from '../../src/models/index.js';

import { probeHarness } from './setup.js';

type Harness = Awaited<ReturnType<typeof probeHarness>>;

/**
 * Bootstrap a visitor session and return its cookie + CSRF token.
 * @param app - The app under test.
 * @param tenantKey - Tenant slug.
 * @returns The visitor cookie value and the issued CSRF token.
 */
async function bootstrapVisitor(
  app: NonNullable<Harness>['app'],
  tenantKey: string,
): Promise<{ cookie: string; csrfToken: string }> {
  const res = await request(app).post('/api/v1/visitor/session').send({ tenantKey });
  expect(res.status).toBe(201);
  const setCookie = res.headers['set-cookie'] as unknown as string[] | string | undefined;
  const cookies = Array.isArray(setCookie) ? setCookie : setCookie === undefined ? [] : [setCookie];
  const raw = cookies.find((c) => c.startsWith('livechat_visitor='));
  const cookie = raw?.split(';')[0]?.replace('livechat_visitor=', '') ?? '';
  return { cookie, csrfToken: res.body.data.csrfToken as string };
}

describe('CSRF protection on visitor write routes (#77)', () => {
  let harness: Harness;

  beforeAll(async () => {
    harness = await probeHarness();
    if (harness === null) {
      console.warn('[integration] MySQL or Redis not reachable — skipping');
      return;
    }
    await Tenant.create({
      name: 'Tenant-csrf',
      slug: 'csrf-t',
      status: 'active',
      domain: null,
      expiresAt: null,
      settings: null,
      allowedOrigins: null,
    });
  }, 60_000);

  afterAll(async () => {
    if (harness !== null) await harness.cleanup();
  });

  test('the bootstrap issues a CSRF token', async () => {
    if (harness === null) return;
    const { csrfToken } = await bootstrapVisitor(harness.app, 'csrf-t');
    expect(typeof csrfToken).toBe('string');
    expect(csrfToken.length).toBeGreaterThan(0);
  });

  test('a cookie-authenticated POST without the token is rejected (403)', async () => {
    if (harness === null) return;
    const { cookie } = await bootstrapVisitor(harness.app, 'csrf-t');

    const res = await request(harness.app)
      .post('/api/v1/visitor/chats')
      .set('cookie', `livechat_visitor=${cookie}`)
      .send({ customerName: 'No Token', body: 'hi' });

    expect(res.status).toBe(403);
  });

  test('a POST with a wrong token is rejected (403)', async () => {
    if (harness === null) return;
    const { cookie } = await bootstrapVisitor(harness.app, 'csrf-t');

    const res = await request(harness.app)
      .post('/api/v1/visitor/chats')
      .set('cookie', `livechat_visitor=${cookie}`)
      .set('X-XSRF-TOKEN', 'not-the-real-token')
      .send({ customerName: 'Wrong Token', body: 'hi' });

    expect(res.status).toBe(403);
  });

  test('a POST with the matching token succeeds', async () => {
    if (harness === null) return;
    const { cookie, csrfToken } = await bootstrapVisitor(harness.app, 'csrf-t');

    const res = await request(harness.app)
      .post('/api/v1/visitor/chats')
      .set('cookie', `livechat_visitor=${cookie}`)
      .set('X-XSRF-TOKEN', csrfToken)
      .send({ customerName: 'Good Token', body: 'hi' });

    expect(res.status).toBe(201);
  });
});
