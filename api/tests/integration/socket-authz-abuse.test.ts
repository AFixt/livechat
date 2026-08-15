import jwt from 'jsonwebtoken';
import { io as ioClient, type Socket } from 'socket.io-client';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';

import { Tenant } from '../../src/models/index.js';

import { probeLiveHarness, type LiveTestHarness } from './setup.js';

/**
 * Resolve with the first `connect_error` for a handshake that must be refused,
 * or reject if the socket unexpectedly connects.
 * @param socket - A freshly created client socket.
 * @param timeoutMs - Max wait before failing the test.
 * @returns The handshake error.
 */
function expectRefused(socket: Socket, timeoutMs = 4000): Promise<Error> {
  return new Promise<Error>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error('handshake neither connected nor errored in time'));
    }, timeoutMs);
    socket.once('connect_error', (err: Error) => {
      clearTimeout(timer);
      resolve(err);
    });
    socket.once('connect', () => {
      clearTimeout(timer);
      reject(new Error('handshake unexpectedly succeeded'));
    });
  });
}

describe('socket.io authorization abuse (integration)', () => {
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

  test('/staff handshake with no token is refused', async () => {
    if (harness === null) return;
    const socket = ioClient(`${harness.baseUrl}/staff`, {
      path: '/api/socket.io',
      transports: ['websocket'],
      forceNew: true,
    });
    const err = await expectRefused(socket);
    expect(err.message).toContain('Authentication required');
    socket.disconnect();
  }, 10_000);

  test('/staff handshake with a malformed token is refused', async () => {
    if (harness === null) return;
    const socket = ioClient(`${harness.baseUrl}/staff`, {
      path: '/api/socket.io',
      auth: { token: 'not.a.jwt' },
      transports: ['websocket'],
      forceNew: true,
    });
    const err = await expectRefused(socket);
    expect(err.message).toContain('Invalid token');
    socket.disconnect();
  }, 10_000);

  test('/staff handshake with a token signed by the wrong secret is refused', async () => {
    if (harness === null) return;
    const forged = jwt.sign(
      { sub: 'attacker', role: 'super_admin', tenantId: null, jti: 'x' },
      'the-wrong-signing-secret',
      { expiresIn: '15m' },
    );
    const socket = ioClient(`${harness.baseUrl}/staff`, {
      path: '/api/socket.io',
      auth: { token: forged },
      transports: ['websocket'],
      forceNew: true,
    });
    const err = await expectRefused(socket);
    expect(err.message).toContain('Invalid token');
    socket.disconnect();
  }, 10_000);

  test('/staff handshake with an expired but otherwise valid token is refused', async () => {
    if (harness === null) return;
    const expired = jwt.sign(
      { sub: 'someone', role: 'staff', tenantId: null, jti: 'y' },
      harness.env.JWT_ACCESS_SECRET,
      { expiresIn: -10 },
    );
    const socket = ioClient(`${harness.baseUrl}/staff`, {
      path: '/api/socket.io',
      auth: { token: expired },
      transports: ['websocket'],
      forceNew: true,
    });
    const err = await expectRefused(socket);
    expect(err.message).toContain('Invalid token');
    socket.disconnect();
  }, 10_000);

  test('/visitor handshake with a forged (well-formed, bad-signature) cookie is refused', async () => {
    if (harness === null) return;
    // Mint a genuine cookie, then corrupt only its HMAC signature so the shape
    // is valid but verification must fail.
    await Tenant.create({
      name: 'Socket Abuse Tenant',
      slug: 'socket-abuse',
      status: 'active',
      domain: null,
      expiresAt: null,
      settings: null,
    });
    const created = await request(harness.baseUrl)
      .post('/api/v1/visitor/session')
      .send({ tenantKey: 'socket-abuse' });
    expect(created.status).toBe(201);
    const setCookie = created.headers['set-cookie'] as string[] | string | undefined;
    const cookies = Array.isArray(setCookie) ? setCookie : setCookie === undefined ? [] : [setCookie];
    const value =
      cookies
        .find((c) => c.startsWith('livechat_visitor='))
        ?.split(';')[0]
        ?.replace('livechat_visitor=', '') ?? '';
    const [sessionId, sig] = value.split('.');
    const forged = `${sessionId ?? ''}.${(sig ?? '').replace(/./g, '0')}`;

    const socket = ioClient(`${harness.baseUrl}/visitor`, {
      path: '/api/socket.io',
      auth: { cookie: forged },
      transports: ['websocket'],
      forceNew: true,
    });
    const err = await expectRefused(socket);
    expect(err.message).toContain('Invalid visitor cookie');
    socket.disconnect();
  }, 15_000);
});
