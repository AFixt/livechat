import { createHmac } from 'node:crypto';

import { io as ioClient, type Socket } from 'socket.io-client';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';

import { ChatMessage, Tenant, User } from '../../src/models/index.js';

import { integrationDbUp, probeLiveHarness, type LiveTestHarness } from './setup.js';

/**
 * Sort a copy of a body list. `delivered_at` is whole-second precision, so
 * messages created in the same second can tie and two queries may return them
 * in different orders — compare as multisets (bodies here are all distinct) so
 * the assertion tests "same messages, none lost or duplicated", not incidental
 * tie ordering.
 */
function sorted(bodies: string[]): string[] {
  return [...bodies].sort();
}

/**
 * Derive the visitor CSRF token the same way the API does (#77): an HMAC of the
 * visitor cookie under the cookie secret. Sending it keeps this test green both
 * before CSRF lands on this branch (the header is simply ignored) and after the
 * develop merge enforces it on cookie-authenticated writes.
 */
function csrfToken(cookie: string, secret: string): string {
  return createHmac('sha256', secret).update(`csrf:${cookie}`).digest('hex');
}

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

async function initVisitor(baseUrl: string, tenantSlug: string): Promise<string> {
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
  return visitorCookie?.split(';')[0]?.replace('livechat_visitor=', '') ?? '';
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

function connectStaff(baseUrl: string, token: string): Socket {
  return ioClient(`${baseUrl}/staff`, {
    path: '/api/socket.io',
    auth: { token },
    transports: ['websocket'],
    forceNew: true,
  });
}

function connectVisitor(baseUrl: string, cookie: string): Socket {
  return ioClient(`${baseUrl}/visitor`, {
    path: '/api/socket.io',
    auth: { cookie },
    transports: ['websocket'],
    forceNew: true,
  });
}

/** The transcript bodies persisted in the DB, oldest first. */
async function dbBodies(chatId: string): Promise<string[]> {
  const rows = await ChatMessage.findAll({ where: { chatId }, order: [['deliveredAt', 'ASC']] });
  return rows.map((r) => r.body);
}

/** The transcript bodies the staff HTTP endpoint returns (the console's backfill source). */
async function staffTranscriptBodies(
  baseUrl: string,
  token: string,
  chatId: string,
): Promise<string[]> {
  const res = await request(baseUrl)
    .get(`/api/v1/chats/${chatId}/messages`)
    .set('authorization', `Bearer ${token}`);
  expect(res.status).toBe(200);
  return (res.body.data as { body: string }[]).map((m) => m.body);
}

/** The transcript bodies the visitor HTTP endpoint returns (the widget's backfill source). */
async function visitorTranscriptBodies(baseUrl: string, cookie: string): Promise<string[]> {
  const res = await request(baseUrl)
    .get('/api/v1/visitor/chats/current')
    .set('cookie', `livechat_visitor=${cookie}`);
  expect(res.status).toBe(200);
  return (res.body.data.messages as { body: string }[]).map((m) => m.body);
}

describe.skipIf(!integrationDbUp)('socket reconnect (integration, #69)', () => {
  let harness: LiveTestHarness | null = null;

  beforeAll(async () => {
    harness = await probeLiveHarness();
    if (harness === null) console.warn('[integration] MySQL or Redis not reachable — skipping');
  }, 60_000);

  afterAll(async () => {
    if (harness !== null) await harness.cleanup();
  });

  test('messages sent during a drop survive, backfill on reconnect, and live delivery resumes', async () => {
    if (harness === null) return;
    const { baseUrl, env } = harness;
    await seedTenantAndStaff('recon', 'staff@recon.example');
    const token = await loginAs(baseUrl, 'staff@recon.example', 'Staff!Password1');
    const cookie = await initVisitor(baseUrl, 'recon');

    const initRes = await request(baseUrl)
      .post('/api/v1/visitor/chats')
      .set('cookie', `livechat_visitor=${cookie}`)
      .set('X-XSRF-TOKEN', csrfToken(cookie, env.COOKIE_SECRET))
      .send({ customerName: 'Visitor One', body: 'hello' });
    expect(initRes.status).toBe(201);
    const chatId = initRes.body.data.chat.id as string;

    let staffSocket = connectStaff(baseUrl, token);
    let visitorSocket = connectVisitor(baseUrl, cookie);
    await Promise.all([waitFor(staffSocket, 'connect'), waitFor(visitorSocket, 'connect')]);
    visitorSocket.emit('chat:join', { chatId });
    staffSocket.emit('chat:accept', { chatId });
    await waitFor(visitorSocket, 'chat:assigned');

    // Baseline: with both ends live, a visitor message reaches the staff socket.
    const baseline = waitFor<{ body: string }>(staffSocket, 'chat:message');
    visitorSocket.emit('chat:message', { chatId, body: 'live baseline' });
    expect((await baseline).body).toBe('live baseline');

    // --- Console (staff) outage -------------------------------------------
    // The staff socket drops; the visitor sends a message while it is down. A
    // reconnected socket is in no rooms, so the staff never receives it live —
    // it must come back via the transcript re-fetch on reconnect (AC5).
    staffSocket.disconnect();
    const visitorEcho = waitFor<{ body: string }>(visitorSocket, 'chat:message');
    visitorSocket.emit('chat:message', { chatId, body: 'sent during console outage' });
    await visitorEcho; // visitor's own echo confirms the server persisted it

    // The console's reconnect backfill source (HTTP transcript) now carries it.
    const afterDrop = await staffTranscriptBodies(baseUrl, token, chatId);
    expect(afterDrop).toContain('sent during console outage');
    expect(sorted(afterDrop)).toEqual(sorted(await dbBodies(chatId)));

    // Reconnect + re-join (what use-staff-socket does on 'connect'), then prove
    // live delivery resumes: a fresh visitor message arrives on the new socket.
    staffSocket = connectStaff(baseUrl, token);
    await waitFor(staffSocket, 'connect');
    staffSocket.emit('chat:join', { chatId });
    const resumed = waitFor<{ body: string }>(staffSocket, 'chat:message');
    visitorSocket.emit('chat:message', { chatId, body: 'after console reconnect' });
    expect((await resumed).body).toBe('after console reconnect');

    // --- Widget (visitor) outage ------------------------------------------
    // Symmetric: the visitor socket drops, staff sends while it is down, and the
    // message must be recoverable from the visitor transcript endpoint.
    visitorSocket.disconnect();
    const staffEcho = waitFor<{ body: string }>(staffSocket, 'chat:message');
    staffSocket.emit('chat:message', { chatId, body: 'sent during widget outage' });
    await staffEcho;

    const afterVisitorDrop = await visitorTranscriptBodies(baseUrl, cookie);
    expect(afterVisitorDrop).toContain('sent during widget outage');
    expect(sorted(afterVisitorDrop)).toEqual(sorted(await dbBodies(chatId)));

    // Visitor reconnects + re-joins; live delivery resumes on the new socket.
    visitorSocket = connectVisitor(baseUrl, cookie);
    await waitFor(visitorSocket, 'connect');
    visitorSocket.emit('chat:join', { chatId });
    const visitorResumed = waitFor<{ body: string }>(visitorSocket, 'chat:message');
    staffSocket.emit('chat:message', { chatId, body: 'after widget reconnect' });
    expect((await visitorResumed).body).toBe('after widget reconnect');

    // Final: both HTTP transcripts agree with the DB, in order, with no gaps or
    // duplicates across the whole drop/reconnect sequence.
    const expected = [
      'hello',
      'live baseline',
      'sent during console outage',
      'after console reconnect',
      'sent during widget outage',
      'after widget reconnect',
    ];
    expect(sorted(await dbBodies(chatId))).toEqual(sorted(expected));
    expect(sorted(await staffTranscriptBodies(baseUrl, token, chatId))).toEqual(sorted(expected));
    expect(sorted(await visitorTranscriptBodies(baseUrl, cookie))).toEqual(sorted(expected));

    staffSocket.disconnect();
    visitorSocket.disconnect();
  }, 30_000);
});
