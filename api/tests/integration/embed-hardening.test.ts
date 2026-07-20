import jwt from 'jsonwebtoken';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';

import { Tenant } from '../../src/models/index.js';

import { probeHarness, type TestHarness } from './setup.js';

describe('embed hardening (integration)', () => {
  let harness: TestHarness | null = null;
  let tenantId = '';

  beforeAll(async () => {
    harness = await probeHarness();
    if (harness === null) {
      console.warn('[integration] MySQL or Redis not reachable — skipping');
      return;
    }
    const tenant = await Tenant.create({
      name: 'Embed Tenant',
      slug: 'embed',
      status: 'active',
      domain: null,
      expiresAt: null,
      settings: { primaryColor: '#123456', supportHoursText: 'Mon–Fri 9–5' },
      allowedOrigins: ['https://client.example.com'],
    });
    tenantId = tenant.id;
  }, 20_000);

  afterAll(async () => {
    if (harness !== null) await harness.cleanup();
  });

  test('GET /widget/config returns the public tenant config', async () => {
    if (harness === null) return;
    const res = await request(harness.app).get('/api/v1/widget/config?tenantKey=embed');
    expect(res.status).toBe(200);
    expect(res.body.data.tenantKey).toBe('embed');
    expect(res.body.data.primaryColor).toBe('#123456');
    expect(res.body.data.allowedOrigins).toEqual(['https://client.example.com']);
    expect(res.body.data).not.toHaveProperty('embedSecret');
  });

  test('GET /widget/config returns 404 for unknown tenant', async () => {
    if (harness === null) return;
    const res = await request(harness.app).get('/api/v1/widget/config?tenantKey=nope');
    expect(res.status).toBe(404);
  });

  test('allowedOrigins: request from disallowed origin is rejected 403', async () => {
    if (harness === null) return;
    const res = await request(harness.app)
      .get('/api/v1/widget/config?tenantKey=embed')
      .set('Origin', 'https://evil.example.com');
    expect(res.status).toBe(403);
  });

  test('allowedOrigins: request from allowed origin is accepted', async () => {
    if (harness === null) return;
    const res = await request(harness.app)
      .get('/api/v1/widget/config?tenantKey=embed')
      .set('Origin', 'https://client.example.com');
    expect(res.status).toBe(200);
  });

  test('identityToken: valid HS256 token sets identity_token_sub', async () => {
    if (harness === null) return;
    const tenant = await Tenant.findByPk(tenantId);
    if (tenant === null) throw new Error('tenant gone');
    const token = jwt.sign({ sub: 'client-user-42', email: 'u@c.example' }, tenant.embedSecret, {
      algorithm: 'HS256',
      expiresIn: '1h',
    });
    const res = await request(harness.app)
      .post('/api/v1/visitor/session')
      .send({ tenantKey: 'embed', identityToken: token });
    expect(res.status).toBe(201);

    // Verify the session row picked up the sub
    const { VisitorSession } = await import('../../src/models/index.js');
    const session = await VisitorSession.findOne({
      where: { id: res.body.data.sessionId },
    });
    expect(session?.identityTokenSub).toBe('client-user-42');
  });

  test('identityToken: token signed with wrong secret is rejected 400', async () => {
    if (harness === null) return;
    const badToken = jwt.sign({ sub: 'nope' }, 'wrong-secret', { algorithm: 'HS256' });
    const res = await request(harness.app)
      .post('/api/v1/visitor/session')
      .send({ tenantKey: 'embed', identityToken: badToken });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/invalid identity token/i);
  });

  test('rotateEmbedSecret: old tokens are rejected after rotation', async () => {
    if (harness === null) return;
    const tenant = await Tenant.findByPk(tenantId);
    if (tenant === null) throw new Error('tenant gone');
    const oldToken = jwt.sign({ sub: 'user-1' }, tenant.embedSecret, {
      algorithm: 'HS256',
      expiresIn: '1h',
    });
    // Rotate via service directly (testing the behavior, not the HTTP route)
    const newSecret = await harness.services.tenant.rotateEmbedSecret(tenantId);
    expect(newSecret).not.toBe(tenant.embedSecret);

    const res = await request(harness.app)
      .post('/api/v1/visitor/session')
      .send({ tenantKey: 'embed', identityToken: oldToken });
    expect(res.status).toBe(400);
  });
});
