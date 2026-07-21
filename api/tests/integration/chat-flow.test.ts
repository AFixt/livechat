import { io as ioClient, type Socket } from 'socket.io-client';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';

import { Tenant, User } from '../../src/models/index.js';

import { probeLiveHarness, type LiveTestHarness } from './setup.js';

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
    passwordHash: 'Staff!Password1',
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

async function loginAs(baseUrl: string, email: string, password: string): Promise<string> {
  const res = await request(baseUrl).post('/api/v1/auth/login').send({ email, password });
  expect(res.status).toBe(200);
  return res.body.data.accessToken as string;
}

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

describe('chat flow (integration)', () => {
  let harness: LiveTestHarness | null = null;

  beforeAll(async () => {
    harness = await probeLiveHarness();
    if (harness === null) {
      console.warn('[integration] MySQL or Redis not reachable — skipping');
    }
  }, 20_000);

  afterAll(async () => {
    if (harness !== null) await harness.cleanup();
  });

  test('visitor and staff can exchange messages over sockets', async () => {
    if (harness === null) return;
    const { baseUrl } = harness;
    await seedTenantAndStaff('acme', 'staff@acme.example');
    const accessToken = await loginAs(baseUrl, 'staff@acme.example', 'Staff!Password1');
    const { cookie: visitorCookie } = await initVisitor(baseUrl, 'acme');

    const initRes = await request(baseUrl)
      .post('/api/v1/visitor/chats')
      .set('cookie', `livechat_visitor=${visitorCookie}`)
      .send({ customerName: 'Visitor One', body: 'Hello, I need help' });
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
    const assigned = await waitFor<{ chatId: string; assignedTo: string }>(
      visitorSocket,
      'chat:assigned',
    );
    expect(assigned.chatId).toBe(chatId);

    const staffReceivesMsg = waitFor<{ chatId: string; body: string; senderKind: string }>(
      staffSocket,
      'chat:message',
    );
    visitorSocket.emit('chat:message', { chatId, body: 'hi there' });
    const receivedByStaff = await staffReceivesMsg;
    expect(receivedByStaff.chatId).toBe(chatId);
    expect(receivedByStaff.body).toBe('hi there');
    expect(receivedByStaff.senderKind).toBe('visitor');

    const visitorReceivesMsg = waitFor<{ chatId: string; body: string; senderKind: string }>(
      visitorSocket,
      'chat:message',
    );
    staffSocket.emit('chat:message', { chatId, body: 'how can I help?' });
    const receivedByVisitor = await visitorReceivesMsg;
    expect(receivedByVisitor.body).toBe('how can I help?');
    expect(receivedByVisitor.senderKind).toBe('user');

    const visitorSeesEnd = waitFor<{ chatId: string; endedBy: string }>(
      visitorSocket,
      'chat:ended',
    );
    staffSocket.emit('chat:end', { chatId });
    const ended = await visitorSeesEnd;
    expect(ended.endedBy).toBe('support');

    staffSocket.disconnect();
    visitorSocket.disconnect();
  }, 30_000);

  test('tenant isolation: tenant A staff never receives tenant B messages', async () => {
    if (harness === null) return;
    const { baseUrl } = harness;
    await seedTenantAndStaff('alpha', 'a-staff@alpha.example');
    await seedTenantAndStaff('beta', 'b-staff@beta.example');

    const staffAToken = await loginAs(baseUrl, 'a-staff@alpha.example', 'Staff!Password1');
    const { cookie: bVisitorCookie } = await initVisitor(baseUrl, 'beta');

    const initRes = await request(baseUrl)
      .post('/api/v1/visitor/chats')
      .set('cookie', `livechat_visitor=${bVisitorCookie}`)
      .send({ customerName: 'B Visitor', body: 'Hello from beta' });
    expect(initRes.status).toBe(201);
    const betaChatId = initRes.body.data.chat.id as string;

    const staffA: Socket = ioClient(`${baseUrl}/staff`, {
      path: '/api/socket.io',
      auth: { token: staffAToken },
      transports: ['websocket'],
      forceNew: true,
    });
    const visitorB: Socket = ioClient(`${baseUrl}/visitor`, {
      path: '/api/socket.io',
      auth: { cookie: bVisitorCookie },
      transports: ['websocket'],
      forceNew: true,
    });
    await Promise.all([waitFor(staffA, 'connect'), waitFor(visitorB, 'connect')]);
    visitorB.emit('chat:join', { chatId: betaChatId });

    let leakedToA = false;
    staffA.on('chat:message', () => {
      leakedToA = true;
    });

    visitorB.emit('chat:message', { chatId: betaChatId, body: 'beta message' });
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(leakedToA).toBe(false);

    staffA.disconnect();
    visitorB.disconnect();
  }, 30_000);

  test('availability drives no_support; current chat + support-initiated wiring', async () => {
    if (harness === null) return;
    const { baseUrl, redis } = harness;
    await seedTenantAndStaff('gamma', 'g-staff@gamma.example');
    const accessToken = await loginAs(baseUrl, 'g-staff@gamma.example', 'Staff!Password1');
    const { cookie: visitorCookie, sessionId } = await initVisitor(baseUrl, 'gamma');

    // no_support: with no staff online, initiate reports supportAvailable=false.
    await redis.del('presence:staff:available');
    const offlineRes = await request(baseUrl)
      .post('/api/v1/visitor/chats')
      .set('cookie', `livechat_visitor=${visitorCookie}`)
      .send({ customerName: 'Gamma Visitor', body: 'anyone home?' });
    expect(offlineRes.status).toBe(201);
    expect(offlineRes.body.data.supportAvailable).toBe(false);
    const priorChatId = offlineRes.body.data.chat.id as string;

    // restart: the returning visitor's resumable chat + transcript is fetchable.
    const currentRes = await request(baseUrl)
      .get('/api/v1/visitor/chats/current')
      .set('cookie', `livechat_visitor=${visitorCookie}`);
    expect(currentRes.status).toBe(200);
    expect(currentRes.body.data.chat.id).toBe(priorChatId);
    expect((currentRes.body.data.messages as unknown[]).length).toBeGreaterThanOrEqual(1);

    // A connected staff socket flips availability to true.
    const staffSocket: Socket = ioClient(`${baseUrl}/staff`, {
      path: '/api/socket.io',
      auth: { token: accessToken },
      transports: ['websocket'],
      forceNew: true,
    });
    await waitFor(staffSocket, 'connect');
    await new Promise((resolve) => setTimeout(resolve, 200));
    const onlineRes = await request(baseUrl)
      .post('/api/v1/visitor/chats')
      .set('cookie', `livechat_visitor=${visitorCookie}`)
      .send({ customerName: 'Gamma Visitor', body: 'still here?' });
    expect(onlineRes.body.data.supportAvailable).toBe(true);

    // support_initiated: staff initiates → the visitor's own room is notified.
    const visitorSocket: Socket = ioClient(`${baseUrl}/visitor`, {
      path: '/api/socket.io',
      auth: { cookie: visitorCookie },
      transports: ['websocket'],
      forceNew: true,
    });
    await waitFor(visitorSocket, 'connect');
    const initiated = waitFor<{ chatId: string }>(visitorSocket, 'support:initiated');
    staffSocket.emit('chat:initiate', { visitorSessionId: sessionId });
    const evt = await initiated;
    expect(typeof evt.chatId).toBe('string');

    staffSocket.disconnect();
    visitorSocket.disconnect();
  }, 30_000);
});
