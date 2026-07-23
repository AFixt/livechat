import { randomUUID } from 'node:crypto';

import request from 'supertest';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';

import { Chat, ChatMessage, Tenant, User, VisitorSession } from '../../src/models/index.js';

import { probeHarness } from './setup.js';

import type { ChatStatus } from '@livechat/shared';
import type { Express } from 'express';

type Harness = Awaited<ReturnType<typeof probeHarness>>;

interface StaffSeed {
  tenantId: string;
  email: string;
  password: string;
}

const STAFF_PASSWORD = 'Staff!Password1';
let staffCounter = 0;

/**
 * Create a staff user attached to an existing tenant (or untenanted, if
 * `tenantId` is `null`).
 * @param tenantId - Owning tenant id, or `null` for an untenanted user.
 * @param label - Unique-ish label folded into the generated email.
 * @returns The new user's login credentials.
 */
async function seedStaff(
  tenantId: string | null,
  label: string,
): Promise<{ email: string; password: string }> {
  staffCounter += 1;
  const email = `staff${String(staffCounter)}-${label}@example.com`;
  await User.create({
    email,
    passwordHash: STAFF_PASSWORD,
    firstName: 'St',
    lastName: 'Aff',
    role: 'staff',
    tenantId,
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
  return { email, password: STAFF_PASSWORD };
}

/**
 * Create a fresh tenant plus one staff member belonging to it.
 * @param tenantSlug - Unique tenant slug.
 * @returns Tenant id and the staff member's login credentials.
 */
async function seedTenantAndStaff(tenantSlug: string): Promise<StaffSeed> {
  const tenant = await Tenant.create({
    name: `Tenant-${tenantSlug}`,
    slug: tenantSlug,
    status: 'active',
    domain: null,
    expiresAt: null,
    settings: null,
  });
  const { email, password } = await seedStaff(tenant.id, tenantSlug);
  return { tenantId: tenant.id, email, password };
}

/**
 * Create a non-staff (`client`) user attached to a tenant.
 * @param tenantId - Owning tenant id.
 * @param label - Unique-ish label folded into the generated email.
 * @returns The new user's login credentials.
 */
async function seedClient(
  tenantId: string,
  label: string,
): Promise<{ email: string; password: string }> {
  staffCounter += 1;
  const email = `client${String(staffCounter)}-${label}@example.com`;
  const password = 'Client!Password1';
  await User.create({
    email,
    passwordHash: password,
    firstName: 'Cl',
    lastName: 'Ient',
    role: 'client',
    tenantId,
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
  return { email, password };
}

/**
 * Log in and return the access token.
 * @param app - Express app under test.
 * @param email - Login email.
 * @param password - Login password.
 * @returns The bearer access token.
 */
async function loginAs(app: Express, email: string, password: string): Promise<string> {
  const res = await request(app).post('/api/v1/auth/login').send({ email, password });
  expect(res.status).toBe(200);
  return res.body.data.accessToken as string;
}

/**
 * Create a visitor session directly via the model (bypassing the widget
 * bootstrap endpoint, which isn't under test here).
 * @param tenantId - Owning tenant id.
 * @returns The new visitor session.
 */
async function seedVisitorSession(tenantId: string): Promise<VisitorSession> {
  const now = new Date();
  return VisitorSession.create({
    tenantId,
    sessionCookieHash: `hash-${randomUUID()}`,
    identityTokenSub: null,
    userAgent: null,
    ipAddress: null,
    country: null,
    city: null,
    language: null,
    currentUrl: null,
    referrer: null,
    status: 'active',
    firstSeenAt: now,
    lastSeenAt: now,
  });
}

interface ChatOverrides {
  status?: ChatStatus;
  assignedTo?: string | null;
  initiatedBy?: 'customer' | 'support';
  endedAt?: Date | null;
}

/**
 * Create a chat directly via the model.
 * @param tenantId - Owning tenant id.
 * @param visitorSessionId - Owning visitor session id.
 * @param overrides - Optional field overrides.
 * @returns The new chat.
 */
async function seedChat(
  tenantId: string,
  visitorSessionId: string,
  overrides: ChatOverrides = {},
): Promise<Chat> {
  return Chat.create({
    tenantId,
    visitorSessionId,
    assignedTo: overrides.assignedTo ?? null,
    initiatedBy: overrides.initiatedBy ?? 'customer',
    status: overrides.status ?? 'pending',
    customerName: 'Test Visitor',
    customerEmail: null,
    startedAt: new Date(),
    endedAt: overrides.endedAt ?? null,
  });
}

/**
 * Create a chat message directly via the model, with an explicit
 * `deliveredAt` so ordering can be tested independently of insertion order.
 * @param chatId - Owning chat id.
 * @param body - Message body.
 * @param deliveredAt - Explicit delivery timestamp.
 * @returns The new message.
 */
async function seedMessage(chatId: string, body: string, deliveredAt: Date): Promise<ChatMessage> {
  return ChatMessage.create({
    chatId,
    senderKind: 'visitor',
    senderUserId: null,
    body,
    deliveredAt,
    readAt: null,
  });
}

describe('chat routes (integration)', () => {
  let harness: Harness;

  beforeAll(async () => {
    harness = await probeHarness();
    if (harness === null) {
      console.warn('[integration] MySQL or Redis not reachable — skipping');
    }
  }, 20_000);

  afterAll(async () => {
    if (harness !== null) await harness.cleanup();
  });

  test('unauthenticated request is rejected with 401', async () => {
    if (harness === null) return;
    const res = await request(harness.app).get('/api/v1/chats');
    expect(res.status).toBe(401);
  });

  test('a non-staff role is forbidden with 403', async () => {
    if (harness === null) return;
    const { app } = harness;
    const { tenantId } = await seedTenantAndStaff('forbid');
    const client = await seedClient(tenantId, 'forbid');
    const token = await loginAs(app, client.email, client.password);

    const res = await request(app).get('/api/v1/chats').set('authorization', `Bearer ${token}`);
    expect(res.status).toBe(403);
  });

  // Issue #43: the REST layer now enforces the same tenant isolation the
  // Socket.IO rooms already did (see chat-flow.test.ts). A tenant-scoped staff
  // member is confined to their own tenant across every chat route — reads and
  // writes alike; only untenanted AFixt staff span tenants.
  test("a tenant-scoped staff member cannot touch another tenant's chat", async () => {
    if (harness === null) return;
    const { app } = harness;
    const staffA = await seedTenantAndStaff('iso-a');
    const staffB = await seedTenantAndStaff('iso-b');
    const visitorB = await seedVisitorSession(staffB.tenantId);
    const chatB = await seedChat(staffB.tenantId, visitorB.id, { status: 'pending' });
    const tokenA = await loginAs(app, staffA.email, staffA.password);
    const auth = `Bearer ${tokenA}`;

    const read = await request(app).get(`/api/v1/chats/${chatB.id}`).set('authorization', auth);
    expect(read.status).toBe(403);

    const transcript = await request(app)
      .get(`/api/v1/chats/${chatB.id}/messages`)
      .set('authorization', auth);
    expect(transcript.status).toBe(403);

    const accept = await request(app)
      .post(`/api/v1/chats/${chatB.id}/accept`)
      .set('authorization', auth);
    expect(accept.status).toBe(403);

    const post = await request(app)
      .post(`/api/v1/chats/${chatB.id}/messages`)
      .set('authorization', auth)
      .send({ body: 'should not land' });
    expect(post.status).toBe(403);

    const end = await request(app)
      .post(`/api/v1/chats/${chatB.id}/end`)
      .set('authorization', auth)
      .send({ endedBy: 'support' });
    expect(end.status).toBe(403);
  });

  test('lists chats, filterable by tenantId and status', async () => {
    if (harness === null) return;
    const { app } = harness;
    const staffA = await seedTenantAndStaff('list-a');
    const staffB = await seedTenantAndStaff('list-b');
    const visitorA = await seedVisitorSession(staffA.tenantId);
    const visitorB = await seedVisitorSession(staffB.tenantId);
    const pendingChatA = await seedChat(staffA.tenantId, visitorA.id, { status: 'pending' });
    const activeChatA = await seedChat(staffA.tenantId, visitorA.id, { status: 'active' });
    const chatB = await seedChat(staffB.tenantId, visitorB.id, { status: 'pending' });
    const token = await loginAs(app, staffA.email, staffA.password);

    // Omitting ?tenantId cannot widen the result set across tenants: a scoped
    // caller is pinned to their own tenant (issue #43).
    const unfiltered = await request(app)
      .get('/api/v1/chats')
      .set('authorization', `Bearer ${token}`);
    expect(unfiltered.status).toBe(200);
    const unfilteredIds = (unfiltered.body.data as { id: string }[]).map((c) => c.id);
    expect(unfilteredIds).toEqual(expect.arrayContaining([pendingChatA.id, activeChatA.id]));
    expect(unfilteredIds).not.toContain(chatB.id);

    // Explicitly asking for someone else's tenant is refused, not silently
    // rewritten to your own.
    const crossTenant = await request(app)
      .get('/api/v1/chats')
      .query({ tenantId: staffB.tenantId })
      .set('authorization', `Bearer ${token}`);
    expect(crossTenant.status).toBe(403);

    const byTenant = await request(app)
      .get('/api/v1/chats')
      .query({ tenantId: staffA.tenantId })
      .set('authorization', `Bearer ${token}`);
    expect(byTenant.status).toBe(200);
    const tenantIds = (byTenant.body.data as { id: string }[]).map((c) => c.id);
    expect(tenantIds).toEqual(expect.arrayContaining([pendingChatA.id, activeChatA.id]));
    expect(tenantIds).not.toContain(chatB.id);

    const byStatus = await request(app)
      .get('/api/v1/chats')
      .query({ status: 'pending' })
      .set('authorization', `Bearer ${token}`);
    expect(byStatus.status).toBe(200);
    const statusIds = (byStatus.body.data as { id: string }[]).map((c) => c.id);
    expect(statusIds).toContain(pendingChatA.id);
    expect(statusIds).not.toContain(activeChatA.id);

    // An invalid status value fails `chatStatusSchema.safeParse` inside
    // `parseStatusQuery`, so the filter is silently dropped rather than
    // rejected — exercises the `parsed.success === false` branch.
    const invalidStatus = await request(app)
      .get('/api/v1/chats')
      .query({ status: 'not-a-real-status' })
      .set('authorization', `Bearer ${token}`);
    expect(invalidStatus.status).toBe(200);
    const invalidStatusIds = (invalidStatus.body.data as { id: string }[]).map((c) => c.id);
    expect(invalidStatusIds).toEqual(expect.arrayContaining([pendingChatA.id, activeChatA.id]));
  });

  test('GET /:id returns a chat, and 404s for an unknown id', async () => {
    if (harness === null) return;
    const { app } = harness;
    const staff = await seedTenantAndStaff('get-one');
    const visitor = await seedVisitorSession(staff.tenantId);
    const chat = await seedChat(staff.tenantId, visitor.id);
    const token = await loginAs(app, staff.email, staff.password);

    const found = await request(app)
      .get(`/api/v1/chats/${chat.id}`)
      .set('authorization', `Bearer ${token}`);
    expect(found.status).toBe(200);
    expect(found.body.data.id).toBe(chat.id);

    const missing = await request(app)
      .get(`/api/v1/chats/${randomUUID()}`)
      .set('authorization', `Bearer ${token}`);
    expect(missing.status).toBe(404);
  });

  test('POST /:id/accept assigns a pending chat and reassigns an already-active one', async () => {
    if (harness === null) return;
    const { app } = harness;
    const staff = await seedTenantAndStaff('accept');
    const second = await seedStaff(staff.tenantId, 'accept-second');
    const visitor = await seedVisitorSession(staff.tenantId);
    const chat = await seedChat(staff.tenantId, visitor.id, { status: 'pending' });
    const token = await loginAs(app, staff.email, staff.password);
    const secondToken = await loginAs(app, second.email, second.password);
    const staffUser = await User.findOne({ where: { email: staff.email } });
    const secondUser = await User.findOne({ where: { email: second.email } });

    const firstAccept = await request(app)
      .post(`/api/v1/chats/${chat.id}/accept`)
      .set('authorization', `Bearer ${token}`);
    expect(firstAccept.status).toBe(200);
    expect(firstAccept.body.data.status).toBe('active');
    expect(firstAccept.body.data.assignedTo).toBe(staffUser?.id);

    // Chat is already active: the `status === 'pending'` branch in
    // `assign()` is NOT retaken, only `assignedTo` changes.
    const secondAccept = await request(app)
      .post(`/api/v1/chats/${chat.id}/accept`)
      .set('authorization', `Bearer ${secondToken}`);
    expect(secondAccept.status).toBe(200);
    expect(secondAccept.body.data.status).toBe('active');
    expect(secondAccept.body.data.assignedTo).toBe(secondUser?.id);

    const missing = await request(app)
      .post(`/api/v1/chats/${randomUUID()}/accept`)
      .set('authorization', `Bearer ${token}`);
    expect(missing.status).toBe(404);
  });

  test('POST /:id/end transitions status by endedBy and is idempotent once ended', async () => {
    if (harness === null) return;
    const { app } = harness;
    const staff = await seedTenantAndStaff('end');
    const visitor = await seedVisitorSession(staff.tenantId);
    const supportEndedChat = await seedChat(staff.tenantId, visitor.id, { status: 'active' });
    const customerEndedChat = await seedChat(staff.tenantId, visitor.id, { status: 'active' });
    const token = await loginAs(app, staff.email, staff.password);

    const supportEnd = await request(app)
      .post(`/api/v1/chats/${supportEndedChat.id}/end`)
      .set('authorization', `Bearer ${token}`)
      .send({ endedBy: 'support' });
    expect(supportEnd.status).toBe(200);
    expect(supportEnd.body.data.status).toBe('ended_by_support');
    expect(supportEnd.body.data.endedAt).not.toBeNull();

    const customerEnd = await request(app)
      .post(`/api/v1/chats/${customerEndedChat.id}/end`)
      .set('authorization', `Bearer ${token}`)
      .send({ endedBy: 'customer' });
    expect(customerEnd.status).toBe(200);
    expect(customerEnd.body.data.status).toBe('ended_by_customer');

    // Re-fetch from the DB rather than trusting the first response's
    // in-memory Date: MySQL's DATETIME column truncates sub-second
    // precision on write, so the persisted value differs from the
    // millisecond-precise value the first response echoed back.
    const persisted = await request(app)
      .get(`/api/v1/chats/${customerEndedChat.id}`)
      .set('authorization', `Bearer ${token}`);
    const endedAtFirst = persisted.body.data.endedAt as string;

    // Already-ended: `endChat()`'s `chat.endedAt !== null` early-return
    // branch — status and endedAt must stay exactly as they were, even
    // though this call asks for a different `endedBy`.
    const secondEnd = await request(app)
      .post(`/api/v1/chats/${customerEndedChat.id}/end`)
      .set('authorization', `Bearer ${token}`)
      .send({ endedBy: 'support' });
    expect(secondEnd.status).toBe(200);
    expect(secondEnd.body.data.status).toBe('ended_by_customer');
    expect(secondEnd.body.data.endedAt).toBe(endedAtFirst);

    const missing = await request(app)
      .post(`/api/v1/chats/${randomUUID()}/end`)
      .set('authorization', `Bearer ${token}`)
      .send({ endedBy: 'support' });
    expect(missing.status).toBe(404);
  });

  test('GET /:id/messages returns the transcript ordered by deliveredAt, not insertion order', async () => {
    if (harness === null) return;
    const { app } = harness;
    const staff = await seedTenantAndStaff('messages');
    const visitor = await seedVisitorSession(staff.tenantId);
    const chat = await seedChat(staff.tenantId, visitor.id, { status: 'active' });
    const token = await loginAs(app, staff.email, staff.password);
    const base = Date.now();

    await seedMessage(chat.id, 'third', new Date(base + 2000));
    await seedMessage(chat.id, 'first', new Date(base));
    await seedMessage(chat.id, 'second', new Date(base + 1000));

    const res = await request(app)
      .get(`/api/v1/chats/${chat.id}/messages`)
      .set('authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    const bodies = (res.body.data as { body: string }[]).map((m) => m.body);
    expect(bodies).toEqual(['first', 'second', 'third']);
  });

  test('POST /:id/messages activates a pending chat on first reply and assigns the sender', async () => {
    if (harness === null) return;
    const { app } = harness;
    const staff = await seedTenantAndStaff('activate');
    const second = await seedStaff(staff.tenantId, 'activate-second');
    const visitor = await seedVisitorSession(staff.tenantId);
    const chat = await seedChat(staff.tenantId, visitor.id, {
      status: 'pending',
      assignedTo: null,
    });
    const token = await loginAs(app, staff.email, staff.password);
    const secondToken = await loginAs(app, second.email, second.password);
    const staffUser = await User.findOne({ where: { email: staff.email } });

    const firstReply = await request(app)
      .post(`/api/v1/chats/${chat.id}/messages`)
      .set('authorization', `Bearer ${token}`)
      .send({ body: 'how can I help?' });
    expect(firstReply.status).toBe(201);

    const afterFirst = await Chat.findByPk(chat.id);
    expect(afterFirst?.status).toBe('active');
    expect(afterFirst?.assignedTo).toBe(staffUser?.id);

    // Chat is already active: the `status === 'pending'` branch in
    // `sendMessage()` is NOT retaken, so a second staffer's reply does not
    // steal the assignment.
    const secondReply = await request(app)
      .post(`/api/v1/chats/${chat.id}/messages`)
      .set('authorization', `Bearer ${secondToken}`)
      .send({ body: 'still here' });
    expect(secondReply.status).toBe(201);

    const afterSecond = await Chat.findByPk(chat.id);
    expect(afterSecond?.status).toBe('active');
    expect(afterSecond?.assignedTo).toBe(staffUser?.id);

    // Ending the chat then replying hits `sendMessage()`'s
    // `chat.endedAt !== null` "chat has ended" rejection branch.
    await request(app)
      .post(`/api/v1/chats/${chat.id}/end`)
      .set('authorization', `Bearer ${token}`)
      .send({ endedBy: 'support' });
    const afterEndReply = await request(app)
      .post(`/api/v1/chats/${chat.id}/messages`)
      .set('authorization', `Bearer ${token}`)
      .send({ body: 'too late' });
    expect(afterEndReply.status).toBe(400);
  });
});
