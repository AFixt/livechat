import { io as ioClient, type Socket } from 'socket.io-client';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';

import { Tenant, User } from '../../src/models/index.js';

import { probeLiveHarness, type LiveTestHarness } from './setup.js';

const STAFF_PASSWORD = 'Staff!Password1';

/**
 * Create a tenant + one staff user attached to it, and return the tenant id.
 * @param tenantSlug - Unique tenant slug.
 * @param email - Staff login email.
 * @returns The new tenant's id.
 */
async function seedTenantAndStaff(
  tenantSlug: string,
  email: string,
): Promise<{ tenantId: string }> {
  const tenant = await Tenant.create({
    name: `Tenant-${tenantSlug}`,
    slug: tenantSlug,
    status: 'active',
    domain: null,
    expiresAt: null,
    settings: null,
  });
  await User.create({
    email,
    passwordHash: STAFF_PASSWORD,
    firstName: 'St',
    lastName: 'Aff',
    role: 'staff',
    tenantId: tenant.id,
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
  return { tenantId: tenant.id };
}

/**
 * Log in a staff user over HTTP and return the access token.
 * @param baseUrl - Live harness base URL.
 * @param email - Login email.
 * @param password - Login password.
 * @returns The bearer access token.
 */
async function loginAs(baseUrl: string, email: string, password: string): Promise<string> {
  const res = await request(baseUrl).post('/api/v1/auth/login').send({ email, password });
  expect(res.status).toBe(200);
  return res.body.data.accessToken as string;
}

/**
 * Init a visitor session over HTTP and return the raw cookie value + session id.
 * @param baseUrl - Live harness base URL.
 * @param tenantSlug - Tenant to attach the session to.
 * @returns The raw `livechat_visitor` cookie value plus the session id.
 */
async function initVisitor(
  baseUrl: string,
  tenantSlug: string,
): Promise<{ cookie: string; sessionId: string }> {
  const res = await request(baseUrl)
    .post('/api/v1/visitor/session')
    .send({ tenantKey: tenantSlug });
  expect(res.status).toBe(201);
  const setCookie = res.headers['set-cookie'] as string | string[] | undefined;
  const cookies: string[] = Array.isArray(setCookie)
    ? setCookie
    : setCookie === undefined
      ? []
      : [setCookie];
  const visitorCookie = cookies.find((c) => c.startsWith('livechat_visitor='));
  const cookie = visitorCookie?.split(';')[0]?.replace('livechat_visitor=', '') ?? '';
  return { cookie, sessionId: res.body.data.sessionId as string };
}

function waitFor<T>(socket: Socket, event: string, timeoutMs = 3000): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`timeout waiting for ${event}`));
    }, timeoutMs);
    socket.once(event, (payload: T) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });
}

describe('visitor namespace + visitor routes (integration)', () => {
  let harness: LiveTestHarness | null = null;

  beforeAll(async () => {
    harness = await probeLiveHarness();
    if (harness === null) {
      console.warn('[integration] MySQL or Redis not reachable — skipping');
    }
  }, 60_000);

  afterAll(async () => {
    if (harness !== null) await harness.cleanup();
  });

  test('connection is rejected without any cookie', async () => {
    if (harness === null) return;
    const { baseUrl } = harness;
    const socket: Socket = ioClient(`${baseUrl}/visitor`, {
      path: '/api/socket.io',
      transports: ['websocket'],
      forceNew: true,
    });
    const err = await waitFor<Error>(socket, 'connect_error');
    expect(err.message).toContain('Visitor cookie required');
    socket.disconnect();
  }, 10_000);

  test('connection is rejected with a garbage cookie', async () => {
    if (harness === null) return;
    const { baseUrl } = harness;
    const socket: Socket = ioClient(`${baseUrl}/visitor`, {
      path: '/api/socket.io',
      auth: { cookie: 'not-a-real-cookie-value' },
      transports: ['websocket'],
      forceNew: true,
    });
    const err = await waitFor<Error>(socket, 'connect_error');
    expect(err.message).toContain('Invalid visitor cookie');
    socket.disconnect();
  }, 10_000);

  test('connection accepts the cookie carried on the raw header instead of auth', async () => {
    if (harness === null) return;
    const { baseUrl } = harness;
    await seedTenantAndStaff('typing-hdr', 'hdr-staff@typing.example');
    const { cookie } = await initVisitor(baseUrl, 'typing-hdr');
    const socket: Socket = ioClient(`${baseUrl}/visitor`, {
      path: '/api/socket.io',
      transports: ['websocket'],
      forceNew: true,
      extraHeaders: { cookie: `livechat_visitor=${cookie}` },
    });
    await waitFor(socket, 'connect');
    socket.disconnect();
  }, 10_000);

  test('chat:typing fans out to the chat room and the staff namespace', async () => {
    if (harness === null) return;
    const { baseUrl } = harness;
    await seedTenantAndStaff('typing', 'staff@typing.example');
    const accessToken = await loginAs(baseUrl, 'staff@typing.example', STAFF_PASSWORD);
    const { cookie: visitorCookie } = await initVisitor(baseUrl, 'typing');

    const initRes = await request(baseUrl)
      .post('/api/v1/visitor/chats')
      .set('cookie', `livechat_visitor=${visitorCookie}`)
      .send({ customerName: 'Typer', body: 'hello' });
    expect(initRes.status).toBe(201);
    const chatId = initRes.body.data.chat.id as string;

    const staffSocket: Socket = ioClient(`${baseUrl}/staff`, {
      path: '/api/socket.io',
      auth: { token: accessToken },
      transports: ['websocket'],
      forceNew: true,
    });
    const visitorSocket: Socket = ioClient(`${baseUrl}/visitor`, {
      path: '/api/socket.io',
      auth: { cookie: visitorCookie },
      transports: ['websocket'],
      forceNew: true,
    });
    await Promise.all([waitFor(staffSocket, 'connect'), waitFor(visitorSocket, 'connect')]);
    visitorSocket.emit('chat:join', { chatId });
    // Staff only joins the `chat:{id}` room on accept — chat:typing (unlike
    // chat:message) is not also mirrored to the tenant room, so without this
    // the staff socket never sees it.
    staffSocket.emit('chat:accept', { chatId });
    await new Promise((resolve) => setTimeout(resolve, 150));

    const otherVisitorSocket: Socket = ioClient(`${baseUrl}/visitor`, {
      path: '/api/socket.io',
      auth: { cookie: visitorCookie },
      transports: ['websocket'],
      forceNew: true,
    });
    await waitFor(otherVisitorSocket, 'connect');
    otherVisitorSocket.emit('chat:join', { chatId });
    await new Promise((resolve) => setTimeout(resolve, 150));

    const staffSeesTyping = waitFor<{ chatId: string; actor: string; isTyping: boolean }>(
      staffSocket,
      'chat:typing',
    );
    const roommateSeesTyping = waitFor<{ chatId: string; actor: string; isTyping: boolean }>(
      otherVisitorSocket,
      'chat:typing',
    );
    visitorSocket.emit('chat:typing', { chatId, isTyping: true });
    const [staffTyping, roommateTyping] = await Promise.all([staffSeesTyping, roommateSeesTyping]);
    expect(staffTyping.chatId).toBe(chatId);
    expect(staffTyping.actor).toBe('visitor');
    expect(staffTyping.isTyping).toBe(true);
    expect(roommateTyping.actor).toBe('visitor');

    staffSocket.disconnect();
    visitorSocket.disconnect();
    otherVisitorSocket.disconnect();
  }, 30_000);

  test('visitor chat:end ends the chat as customer and notifies staff', async () => {
    if (harness === null) return;
    const { baseUrl } = harness;
    await seedTenantAndStaff('vend', 'staff@vend.example');
    const accessToken = await loginAs(baseUrl, 'staff@vend.example', STAFF_PASSWORD);
    const { cookie: visitorCookie } = await initVisitor(baseUrl, 'vend');

    const initRes = await request(baseUrl)
      .post('/api/v1/visitor/chats')
      .set('cookie', `livechat_visitor=${visitorCookie}`)
      .send({ customerName: 'Ender', body: 'bye soon' });
    expect(initRes.status).toBe(201);
    const chatId = initRes.body.data.chat.id as string;

    const staffSocket: Socket = ioClient(`${baseUrl}/staff`, {
      path: '/api/socket.io',
      auth: { token: accessToken },
      transports: ['websocket'],
      forceNew: true,
    });
    const visitorSocket: Socket = ioClient(`${baseUrl}/visitor`, {
      path: '/api/socket.io',
      auth: { cookie: visitorCookie },
      transports: ['websocket'],
      forceNew: true,
    });
    await Promise.all([waitFor(staffSocket, 'connect'), waitFor(visitorSocket, 'connect')]);
    visitorSocket.emit('chat:join', { chatId });
    staffSocket.emit('chat:accept', { chatId });
    await new Promise((resolve) => setTimeout(resolve, 150));

    const staffSeesEnd = waitFor<{ chatId: string; endedBy: string }>(staffSocket, 'chat:ended');
    visitorSocket.emit('chat:end', { chatId });
    const ended = await staffSeesEnd;
    expect(ended.chatId).toBe(chatId);
    expect(ended.endedBy).toBe('customer');

    staffSocket.disconnect();
    visitorSocket.disconnect();
  }, 30_000);

  test('visitor:page_changed fans out to the tenant staff room', async () => {
    if (harness === null) return;
    const { baseUrl } = harness;
    await seedTenantAndStaff('pagechange', 'staff@pagechange.example');
    const accessToken = await loginAs(baseUrl, 'staff@pagechange.example', STAFF_PASSWORD);
    const { cookie: visitorCookie, sessionId } = await initVisitor(baseUrl, 'pagechange');

    const staffSocket: Socket = ioClient(`${baseUrl}/staff`, {
      path: '/api/socket.io',
      auth: { token: accessToken },
      transports: ['websocket'],
      forceNew: true,
    });
    await waitFor(staffSocket, 'connect');
    await new Promise((resolve) => setTimeout(resolve, 150));

    const visitorSocket: Socket = ioClient(`${baseUrl}/visitor`, {
      path: '/api/socket.io',
      auth: { cookie: visitorCookie },
      transports: ['websocket'],
      forceNew: true,
    });
    await waitFor(visitorSocket, 'connect');

    const staffSeesPageChange = waitFor<{ visitorSessionId: string; currentUrl: string }>(
      staffSocket,
      'visitor:page_changed',
    );
    visitorSocket.emit('visitor:page_changed', { currentUrl: 'https://example.com/pricing' });
    const evt = await staffSeesPageChange;
    expect(evt.visitorSessionId).toBe(sessionId);
    expect(evt.currentUrl).toBe('https://example.com/pricing');

    staffSocket.disconnect();
    visitorSocket.disconnect();
  }, 30_000);

  test('visitor disconnect removes presence and notifies staff visitor:left', async () => {
    if (harness === null) return;
    const { baseUrl } = harness;
    await seedTenantAndStaff('leaving', 'staff@leaving.example');
    const accessToken = await loginAs(baseUrl, 'staff@leaving.example', STAFF_PASSWORD);
    const { cookie: visitorCookie, sessionId } = await initVisitor(baseUrl, 'leaving');

    const staffSocket: Socket = ioClient(`${baseUrl}/staff`, {
      path: '/api/socket.io',
      auth: { token: accessToken },
      transports: ['websocket'],
      forceNew: true,
    });
    await waitFor(staffSocket, 'connect');
    await new Promise((resolve) => setTimeout(resolve, 150));

    const visitorSocket: Socket = ioClient(`${baseUrl}/visitor`, {
      path: '/api/socket.io',
      auth: { cookie: visitorCookie },
      transports: ['websocket'],
      forceNew: true,
    });
    await waitFor(visitorSocket, 'connect');
    await new Promise((resolve) => setTimeout(resolve, 150));

    const staffSeesLeft = waitFor<{ tenantId: string; visitorSessionId: string }>(
      staffSocket,
      'visitor:left',
    );
    visitorSocket.disconnect();
    const evt = await staffSeesLeft;
    expect(evt.visitorSessionId).toBe(sessionId);

    staffSocket.disconnect();
  }, 30_000);

  test('POST /visitor/session persists the optional language/currentUrl/referrer fields', async () => {
    if (harness === null) return;
    const { baseUrl } = harness;
    await seedTenantAndStaff('optfields', 'staff@optfields.example');
    const res = await request(baseUrl).post('/api/v1/visitor/session').send({
      tenantKey: 'optfields',
      language: 'en-US',
      currentUrl: 'https://example.com/landing',
      referrer: 'https://google.com/search',
    });
    expect(res.status).toBe(201);

    const { VisitorSession } = await import('../../src/models/index.js');
    const session = await VisitorSession.findByPk(res.body.data.sessionId as string);
    expect(session?.language).toBe('en-US');
    expect(session?.currentUrl).toBe('https://example.com/landing');
    expect(session?.referrer).toBe('https://google.com/search');
  });

  test('POST /visitor/heartbeat without a cookie is unauthorized', async () => {
    if (harness === null) return;
    const { baseUrl } = harness;
    const res = await request(baseUrl).post('/api/v1/visitor/heartbeat').send({});
    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });

  test('POST /visitor/heartbeat with a valid cookie updates the session and returns 200', async () => {
    if (harness === null) return;
    const { baseUrl } = harness;
    await seedTenantAndStaff('heartbeat', 'staff@heartbeat.example');
    const { cookie } = await initVisitor(baseUrl, 'heartbeat');

    const res = await request(baseUrl)
      .post('/api/v1/visitor/heartbeat')
      .set('cookie', `livechat_visitor=${cookie}`)
      .send({ currentUrl: 'https://example.com/heartbeat' });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  test('GET /visitor/chats/current without a cookie is unauthorized', async () => {
    if (harness === null) return;
    const { baseUrl } = harness;
    const res = await request(baseUrl).get('/api/v1/visitor/chats/current');
    expect(res.status).toBe(401);
  });

  test('GET /visitor/chats/current returns null chat + empty messages when none exists', async () => {
    if (harness === null) return;
    const { baseUrl } = harness;
    await seedTenantAndStaff('nochat', 'staff@nochat.example');
    const { cookie } = await initVisitor(baseUrl, 'nochat');

    const res = await request(baseUrl)
      .get('/api/v1/visitor/chats/current')
      .set('cookie', `livechat_visitor=${cookie}`);
    expect(res.status).toBe(200);
    expect(res.body.data.chat).toBeNull();
    expect(res.body.data.messages).toEqual([]);
  });
});
