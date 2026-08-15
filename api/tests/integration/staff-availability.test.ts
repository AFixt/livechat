import { io as ioClient, type Socket } from 'socket.io-client';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';

import { Tenant, User } from '../../src/models/index.js';

import { probeLiveHarness, type LiveTestHarness } from './setup.js';

const STAFF_PASSWORD = 'Staff!Password1';

/**
 * Create a tenant (optionally with a support-hours schedule) plus one staff
 * user attached to it.
 * @param tenantSlug - Unique tenant slug.
 * @param email - Staff login email.
 * @param settings - Optional tenant settings (e.g. supportHours).
 * @returns The tenant id and the staff user id.
 */
async function seedTenantAndStaff(
  tenantSlug: string,
  email: string,
  settings: Record<string, unknown> | null = null,
): Promise<{ tenantId: string; userId: string }> {
  const tenant = await Tenant.create({
    name: `Tenant-${tenantSlug}`,
    slug: tenantSlug,
    status: 'active',
    domain: null,
    expiresAt: null,
    settings,
  });
  const user = await User.create({
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
  return { tenantId: tenant.id, userId: user.id };
}

/**
 * Log in a staff user over HTTP and return the access token.
 * @param baseUrl - Live harness base URL.
 * @param email - Login email.
 * @returns The bearer access token.
 */
async function loginAs(baseUrl: string, email: string): Promise<string> {
  const res = await request(baseUrl)
    .post('/api/v1/auth/login')
    .send({ email, password: STAFF_PASSWORD });
  expect(res.status).toBe(200);
  return res.body.data.accessToken as string;
}

/**
 * Open a connected staff socket for an access token.
 * @param baseUrl - Live harness base URL.
 * @param token - Staff access token.
 * @returns The connected socket.
 */
async function connectStaff(baseUrl: string, token: string): Promise<Socket> {
  const socket = ioClient(`${baseUrl}/staff`, {
    path: '/api/socket.io',
    auth: { token },
    transports: ['websocket'],
    forceNew: true,
  });
  await waitFor(socket, 'connect');
  return socket;
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

const settle = (ms = 150): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

describe('staff availability (integration)', () => {
  let harness: LiveTestHarness | null = null;

  beforeAll(async () => {
    harness = await probeLiveHarness();
    if (harness === null) console.warn('[integration] MySQL or Redis not reachable — skipping');
  }, 60_000);

  afterAll(async () => {
    if (harness !== null) await harness.cleanup();
  });

  test('a connected agent is NOT available until they explicitly opt in', async () => {
    if (harness === null) return;
    const { baseUrl, services } = harness;
    const { tenantId } = await seedTenantAndStaff('avail-optin', 'optin@avail.example');
    const token = await loginAs(baseUrl, 'optin@avail.example');

    const socket = await connectStaff(baseUrl, token);
    // Connecting no longer marks the agent available — presence is explicit.
    const selfOnConnect = await waitFor<{ status: string }>(socket, 'availability:self');
    expect(selfOnConnect.status).toBe('away');
    expect(await services.presence.anyStaffAvailable(tenantId)).toBe(false);

    socket.emit('availability:set', { status: 'available' });
    await waitFor<{ status: string }>(socket, 'availability:self');
    expect(await services.presence.anyStaffAvailable(tenantId)).toBe(true);

    socket.disconnect();
  }, 20_000);

  test('availability is per-user, not per-socket: a second tab closing does not drop it', async () => {
    if (harness === null) return;
    const { baseUrl, services } = harness;
    const { tenantId } = await seedTenantAndStaff('avail-multitab', 'multitab@avail.example');
    const token = await loginAs(baseUrl, 'multitab@avail.example');

    const tabA = await connectStaff(baseUrl, token);
    const tabB = await connectStaff(baseUrl, token);
    await settle();

    // Setting available in one tab is echoed to the other (same user room).
    const bSeesSelf = waitFor<{ status: string }>(tabB, 'availability:self');
    tabA.emit('availability:set', { status: 'available' });
    expect((await bSeesSelf).status).toBe('available');
    expect(await services.presence.anyStaffAvailable(tenantId)).toBe(true);

    // Closing one tab must not flip the agent away while the other is open.
    tabB.disconnect();
    await settle();
    expect(await services.presence.anyStaffAvailable(tenantId)).toBe(true);

    tabA.disconnect();
  }, 20_000);

  test('explicit away status persists across a reconnect (survives reload)', async () => {
    if (harness === null) return;
    const { baseUrl, services } = harness;
    const { tenantId } = await seedTenantAndStaff('avail-persist', 'persist@avail.example');
    const token = await loginAs(baseUrl, 'persist@avail.example');

    const first = await connectStaff(baseUrl, token);
    first.emit('availability:set', { status: 'available' });
    await waitFor(first, 'availability:self');
    expect(await services.presence.anyStaffAvailable(tenantId)).toBe(true);
    first.disconnect();
    await settle();

    // Reconnect restores the persisted 'available' status, not a default.
    const second = await connectStaff(baseUrl, token);
    const restored = await waitFor<{ status: string }>(second, 'availability:self');
    expect(restored.status).toBe('available');
    expect(await services.presence.anyStaffAvailable(tenantId)).toBe(true);
    second.disconnect();
  }, 20_000);

  test('anyStaffAvailable is gated by tenant support hours', async () => {
    if (harness === null) return;
    const { baseUrl, services } = harness;
    // Configure a schedule that is closed on every day so "now" is outside it.
    const { tenantId } = await seedTenantAndStaff('avail-hours', 'hours@avail.example', {
      supportHours: { tz: 'UTC', days: {}, text: 'By appointment only' },
    });
    const token = await loginAs(baseUrl, 'hours@avail.example');
    const socket = await connectStaff(baseUrl, token);
    socket.emit('availability:set', { status: 'available' });
    await waitFor(socket, 'availability:self');

    // Agent is explicitly available, but the tenant is outside support hours.
    const { Tenant: TenantModel } = await import('../../src/models/index.js');
    const tenant = await TenantModel.findByPk(tenantId, { attributes: ['settings'] });
    const { parseSupportHours } = await import('../../src/services/support-hours.js');
    const supportHours = parseSupportHours(tenant?.settings?.supportHours);
    expect(await services.presence.anyStaffAvailable(tenantId, { supportHours })).toBe(false);
    // Without the schedule (24/7) the same agent counts as available.
    expect(await services.presence.anyStaffAvailable(tenantId)).toBe(true);

    socket.disconnect();
  }, 20_000);

  test('availability change bridges to the visitor room via support:availability_changed', async () => {
    if (harness === null) return;
    const { baseUrl } = harness;
    await seedTenantAndStaff('avail-bridge', 'bridge@avail.example');
    const token = await loginAs(baseUrl, 'bridge@avail.example');

    // A visitor session joins the tenant's visitor room on connect.
    const initRes = await request(baseUrl)
      .post('/api/v1/visitor/session')
      .send({ tenantKey: 'avail-bridge' });
    expect(initRes.status).toBe(201);
    const setCookie = initRes.headers['set-cookie'] as string[] | string | undefined;
    const cookieHeader = Array.isArray(setCookie) ? setCookie[0] : setCookie;
    const cookie = (cookieHeader ?? '').split(';')[0]?.replace('livechat_visitor=', '') ?? '';

    const visitorSocket = ioClient(`${baseUrl}/visitor`, {
      path: '/api/socket.io',
      auth: { cookie },
      transports: ['websocket'],
      forceNew: true,
    });
    await waitFor(visitorSocket, 'connect');
    await settle();

    const staffSocket = await connectStaff(baseUrl, token);
    const visitorSeesAvailable = waitFor<{ available: boolean }>(
      visitorSocket,
      'support:availability_changed',
    );
    staffSocket.emit('availability:set', { status: 'available' });
    expect((await visitorSeesAvailable).available).toBe(true);

    staffSocket.disconnect();
    visitorSocket.disconnect();
  }, 20_000);
});
