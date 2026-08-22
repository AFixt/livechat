import request from 'supertest';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';

import { createApp } from '../../src/app.js';
import { computeCsrfToken } from '../../src/middlewares/csrf.js';
import { Tenant } from '../../src/models/index.js';

import { probeHarness, type TestHarness } from './setup.js';

import type { Express } from 'express';

const TENANT_SLUG = 'sec-regression';

/**
 * Read the `livechat_visitor` cookie's full attribute string off a response.
 * @param res - A supertest response.
 * @returns The raw `Set-Cookie` entry for the visitor cookie, or `undefined`.
 */
function visitorSetCookie(res: {
  headers: Record<string, string | string[] | undefined>;
}): string | undefined {
  const header = res.headers['set-cookie'];
  const cookies = Array.isArray(header) ? header : header === undefined ? [] : [header];
  return cookies.find((c) => c.startsWith('livechat_visitor='));
}

/**
 * Assert that a response body is the generic non-leaking error envelope: no
 * stack trace, SQL, or filesystem path anywhere in the serialized payload.
 * @param body - The parsed response body.
 */
function expectNoLeak(body: unknown): void {
  expect(body).toHaveProperty('success', false);
  const serialized = JSON.stringify(body);
  expect(serialized).not.toContain('/Users/');
  expect(serialized).not.toMatch(/\bat Object\./);
  expect(serialized).not.toMatch(/\.ts:\d+/);
  expect(serialized.toLowerCase()).not.toContain('sequelize');
  expect(serialized.toLowerCase()).not.toContain('econnrefused');
}

describe('security regression: input validation + storage (integration)', () => {
  let harness: TestHarness | null = null;
  let prodApp: Express | null = null;

  beforeAll(async () => {
    harness = await probeHarness();
    if (harness === null) {
      console.warn('[integration] MySQL or Redis not reachable — skipping');
      return;
    }
    await Tenant.create({
      name: 'Sec Regression Tenant',
      slug: TENANT_SLUG,
      status: 'active',
      domain: null,
      expiresAt: null,
      settings: null,
    });
    // A second app whose env reports production, so we can assert the visitor
    // cookie gains the `Secure` flag there. It shares the live DB/Redis/services.
    prodApp = createApp({
      env: { ...harness.env, NODE_ENV: 'production', isProduction: true, isTest: false },
      logger: harness.logger,
      redis: harness.redis,
      services: harness.services,
      skipRateLimit: true,
    });
  }, 60_000);

  afterAll(async () => {
    if (harness !== null) await harness.cleanup();
  });

  describe('zod validation rejects bad input with 400, never 500', () => {
    test('auth/register with wrong field types is a 400', async () => {
      if (harness === null) return;
      const res = await request(harness.app)
        .post('/api/v1/auth/register')
        .send({ email: 123, password: [], firstName: null, lastName: 7, token: {} });
      expect(res.status).toBe(400);
      expect(res.body.message).toBe('Validation failed');
      expectNoLeak(res.body);
    });

    test('auth/login with a missing password is a 400', async () => {
      if (harness === null) return;
      const res = await request(harness.app)
        .post('/api/v1/auth/login')
        .send({ email: 'someone@example.com' });
      expect(res.status).toBe(400);
      expectNoLeak(res.body);
    });

    test('auth/login with an SQL-injection-ish email is rejected by validation (400)', async () => {
      if (harness === null) return;
      const res = await request(harness.app)
        .post('/api/v1/auth/login')
        .send({ email: "' OR 1=1 --", password: "'; DROP TABLE users; --" });
      expect(res.status).toBe(400);
      expectNoLeak(res.body);
    });

    test('visitor/session with a missing tenantKey is a 400', async () => {
      if (harness === null) return;
      const res = await request(harness.app).post('/api/v1/visitor/session').send({});
      expect(res.status).toBe(400);
      expectNoLeak(res.body);
    });

    test('visitor/session with a wrong-typed tenantKey is a 400', async () => {
      if (harness === null) return;
      const res = await request(harness.app)
        .post('/api/v1/visitor/session')
        .send({ tenantKey: 12345 });
      expect(res.status).toBe(400);
      expectNoLeak(res.body);
    });

    test('visitor/chats with an invalid body is a 400 (before the cookie check)', async () => {
      if (harness === null) return;
      const res = await request(harness.app)
        .post('/api/v1/visitor/chats')
        .send({ customerName: '', body: '' });
      expect(res.status).toBe(400);
      expectNoLeak(res.body);
    });

    test('an injection string in tenantKey is treated as a literal slug — clean 400, no SQL error', async () => {
      if (harness === null) return;
      const res = await request(harness.app)
        .post('/api/v1/visitor/session')
        .send({ tenantKey: "'; DROP TABLE tenants; --" });
      // Parameterized lookup finds no such slug: a clean 4xx, never a 500.
      expect(res.status).toBe(400);
      expect(res.status).not.toBe(500);
      expectNoLeak(res.body);
    });
  });

  describe('malformed / oversized request bodies', () => {
    test('malformed JSON on auth/login is a 400, not a 500', async () => {
      if (harness === null) return;
      const res = await request(harness.app)
        .post('/api/v1/auth/login')
        .set('Content-Type', 'application/json')
        .send('{"email": "a@b.co", ');
      expect(res.status).toBe(400);
      expect(res.body).toEqual({ success: false, message: 'Malformed request body' });
    });

    test('a body beyond the 1mb json limit is a 413, not a 500', async () => {
      if (harness === null) return;
      const oversized = JSON.stringify({ tenantKey: 'x'.repeat(1_200_000) });
      const res = await request(harness.app)
        .post('/api/v1/visitor/session')
        .set('Content-Type', 'application/json')
        .send(oversized);
      expect(res.status).toBe(413);
      expect(res.body).toEqual({ success: false, message: 'Request payload too large' });
    });
  });

  describe('visitor session cookie flags + forgery', () => {
    test('the visitor cookie is HttpOnly + SameSite=Lax (dev: no Secure)', async () => {
      if (harness === null) return;
      const res = await request(harness.app)
        .post('/api/v1/visitor/session')
        .send({ tenantKey: TENANT_SLUG });
      expect(res.status).toBe(201);
      const cookie = visitorSetCookie(res);
      expect(cookie).toBeDefined();
      expect(cookie).toMatch(/HttpOnly/i);
      expect(cookie).toMatch(/SameSite=Lax/i);
      // Non-production: the Secure attribute must be absent so localhost works.
      expect(cookie).not.toMatch(/Secure/i);
    });

    test('in production the visitor cookie also carries Secure', async () => {
      if (harness === null || prodApp === null) return;
      const res = await request(prodApp)
        .post('/api/v1/visitor/session')
        .send({ tenantKey: TENANT_SLUG });
      expect(res.status).toBe(201);
      const cookie = visitorSetCookie(res);
      expect(cookie).toBeDefined();
      expect(cookie).toMatch(/HttpOnly/i);
      expect(cookie).toMatch(/SameSite=Lax/i);
      expect(cookie).toMatch(/Secure/i);
    });

    test('auth/login does not set any session cookie (JWTs are returned in the body)', async () => {
      if (harness === null) return;
      // Wrong credentials still exercise the response path; we only assert the
      // absence of a Set-Cookie so a future accidental cookie is caught.
      const res = await request(harness.app)
        .post('/api/v1/auth/login')
        .send({ email: 'nobody@example.com', password: 'whatever-123' });
      expect(res.headers['set-cookie']).toBeUndefined();
    });

    test('a valid visitor cookie is accepted, a forged one is rejected 401', async () => {
      if (harness === null) return;
      const created = await request(harness.app)
        .post('/api/v1/visitor/session')
        .send({ tenantKey: TENANT_SLUG });
      expect(created.status).toBe(201);
      const rawCookie = visitorSetCookie(created)?.split(';')[0] ?? '';
      const value = rawCookie.replace('livechat_visitor=', '');
      expect(value).toContain('.');

      // Positive control: the genuine cookie authenticates the heartbeat.
      // The heartbeat is a CSRF-protected write (#77), so the token issued
      // alongside the cookie has to be echoed — this asserts cookie validity,
      // not CSRF behavior, which `csrf.test.ts` covers.
      const ok = await request(harness.app)
        .post('/api/v1/visitor/heartbeat')
        .set('Cookie', rawCookie)
        .set('X-XSRF-TOKEN', created.body.data.csrfToken as string)
        .send({});
      expect(ok.status).toBe(200);

      // Forge it: keep the session id, corrupt the HMAC signature.
      const [sessionId, sig] = value.split('.');
      const forgedSig = (sig ?? '').replace(/./g, '0');
      const forged = `livechat_visitor=${sessionId ?? ''}.${forgedSig}`;
      // Give the forged cookie its own matching CSRF token so the CSRF layer
      // passes and the cookie-signature check is what actually answers. Without
      // this the request is rejected at the CSRF layer (403) and the test would
      // no longer be exercising signature verification at all.
      const bad = await request(harness.app)
        .post('/api/v1/visitor/heartbeat')
        .set('Cookie', forged)
        .set(
          'X-XSRF-TOKEN',
          computeCsrfToken(forged.replace('livechat_visitor=', ''), harness.env.COOKIE_SECRET),
        )
        .send({});
      expect(bad.status).toBe(401);
      expectNoLeak(bad.body);
    });
  });
});
