import { io as ioClient, type Socket } from 'socket.io-client';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';

import { Tenant, VisitorSession } from '../../src/models/index.js';

import { integrationDbUp, probeLiveHarness, type LiveTestHarness } from './setup.js';

const HOUR_MS = 60 * 60 * 1000;

/**
 * Bootstrap a visitor session over HTTP.
 * @param baseUrl - Live harness base URL.
 * @param tenantKey - Tenant slug.
 * @returns The visitor cookie value and session id.
 */
async function bootstrap(
  baseUrl: string,
  tenantKey: string,
): Promise<{ cookie: string; sessionId: string }> {
  const res = await request(baseUrl).post('/api/v1/visitor/session').send({ tenantKey });
  expect(res.status).toBe(201);
  const setCookie = res.headers['set-cookie'] as unknown as string[] | string | undefined;
  const cookies = Array.isArray(setCookie) ? setCookie : setCookie === undefined ? [] : [setCookie];
  const raw = cookies.find((c) => c.startsWith('livechat_visitor='));
  const cookie = raw?.split(';')[0]?.replace('livechat_visitor=', '') ?? '';
  return { cookie, sessionId: res.body.data.sessionId as string };
}

/**
 * Expect a visitor socket handshake to be refused for a cookie.
 * @param baseUrl - Live harness base URL.
 * @param cookie - The (expired/invalid) visitor cookie value.
 * @returns Resolves true if the connection was refused.
 */
async function socketRefused(baseUrl: string, cookie: string): Promise<boolean> {
  const socket: Socket = ioClient(`${baseUrl}/visitor`, {
    path: '/api/socket.io',
    auth: { cookie },
    transports: ['websocket'],
    forceNew: true,
  });
  return new Promise<boolean>((resolve) => {
    const timer = setTimeout(() => {
      socket.disconnect();
      resolve(false);
    }, 3000);
    socket.on('connect', () => {
      clearTimeout(timer);
      socket.disconnect();
      resolve(false);
    });
    socket.on('connect_error', () => {
      clearTimeout(timer);
      socket.disconnect();
      resolve(true);
    });
  });
}

describe.skipIf(!integrationDbUp)('visitor session expiry + revocation (#79)', () => {
  let harness: LiveTestHarness | null = null;

  beforeAll(async () => {
    harness = await probeLiveHarness();
    if (harness === null) {
      console.warn('[integration] stack not reachable — skipping');
      return;
    }
    await Tenant.create({
      name: 'Tenant-expiry',
      slug: 'expiry-t',
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

  test('an absolutely-expired session is 401 on HTTP and refused on the socket', async () => {
    if (harness === null) return;
    const { baseUrl } = harness;
    const { cookie, sessionId } = await bootstrap(baseUrl, 'expiry-t');
    // Push first contact beyond the 720h absolute window.
    await VisitorSession.update(
      { firstSeenAt: new Date(Date.now() - 721 * HOUR_MS) },
      { where: { id: sessionId } },
    );

    const http = await request(baseUrl)
      .get('/api/v1/visitor/chats/current')
      .set('cookie', `livechat_visitor=${cookie}`);
    expect(http.status).toBe(401);
    expect(await socketRefused(baseUrl, cookie)).toBe(true);
  }, 30_000);

  test('an idle-expired session is 401 on HTTP and refused on the socket', async () => {
    if (harness === null) return;
    const { baseUrl } = harness;
    const { cookie, sessionId } = await bootstrap(baseUrl, 'expiry-t');
    // Last seen beyond the 72h idle window (first contact still recent).
    await VisitorSession.update(
      { lastSeenAt: new Date(Date.now() - 73 * HOUR_MS) },
      { where: { id: sessionId } },
    );

    const http = await request(baseUrl)
      .get('/api/v1/visitor/chats/current')
      .set('cookie', `livechat_visitor=${cookie}`);
    expect(http.status).toBe(401);
    expect(await socketRefused(baseUrl, cookie)).toBe(true);
  }, 30_000);

  test('"forget me" on an already-expired session still deletes the PII row', async () => {
    if (harness === null) return;
    const { baseUrl } = harness;
    const { cookie, sessionId } = await bootstrap(baseUrl, 'expiry-t');
    // Session has gone idle-expired before the visitor asks to be forgotten.
    await VisitorSession.update(
      { lastSeenAt: new Date(Date.now() - 73 * HOUR_MS) },
      { where: { id: sessionId } },
    );

    const forget = await request(baseUrl)
      .post('/api/v1/visitor/session/forget')
      .set('cookie', `livechat_visitor=${cookie}`);
    expect(forget.status).toBe(200);

    // Geo-privacy deletion must happen even though the session was expired.
    const gone = await VisitorSession.findByPk(sessionId, { paranoid: false });
    expect(gone).toBeNull();
  }, 30_000);

  test('"forget me" revokes the session: the row is gone and the cookie 401s', async () => {
    if (harness === null) return;
    const { baseUrl } = harness;
    const { cookie, sessionId } = await bootstrap(baseUrl, 'expiry-t');

    const forget = await request(baseUrl)
      .post('/api/v1/visitor/session/forget')
      .set('cookie', `livechat_visitor=${cookie}`);
    expect(forget.status).toBe(200);

    const gone = await VisitorSession.findByPk(sessionId, { paranoid: false });
    expect(gone).toBeNull();

    const http = await request(baseUrl)
      .get('/api/v1/visitor/chats/current')
      .set('cookie', `livechat_visitor=${cookie}`);
    expect(http.status).toBe(401);
    expect(await socketRefused(baseUrl, cookie)).toBe(true);
  }, 30_000);
});
