import request from 'supertest';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';

import { Tenant } from '../../src/models/index.js';

import { probeHarness } from './setup.js';

import type { Express } from 'express';

type Harness = Awaited<ReturnType<typeof probeHarness>>;

/**
 * Extract the raw `livechat_visitor` cookie value from a Set-Cookie header.
 * @param setCookie - The response's set-cookie header.
 * @returns The cookie value, or ''.
 */
function extractVisitorCookie(setCookie: string | string[] | undefined): string {
  const cookies = Array.isArray(setCookie) ? setCookie : setCookie === undefined ? [] : [setCookie];
  const found = cookies.find((c) => c.startsWith('livechat_visitor='));
  return found?.split(';')[0]?.replace('livechat_visitor=', '') ?? '';
}

/**
 * Boot a visitor session and return its cookie.
 * @param app - Express app under test.
 * @param tenantKey - Tenant slug.
 * @returns The visitor cookie value.
 */
async function initVisitor(app: Express, tenantKey: string): Promise<VisitorCreds> {
  const res = await request(app).post('/api/v1/visitor/session').send({ tenantKey });
  expect(res.status).toBe(201);
  return {
    cookie: extractVisitorCookie(res.headers['set-cookie']),
    // Every cookie-authenticated visitor write needs the CSRF token (#77),
    // including the transcript route.
    csrfToken: res.body.data.csrfToken as string,
  };
}

/** A booted visitor: their signed cookie plus the CSRF token bound to it. */
interface VisitorCreds {
  cookie: string;
  csrfToken: string;
}

describe('email transcript (#80)', () => {
  let harness: Harness;

  beforeAll(async () => {
    harness = await probeHarness();
    if (harness === null) {
      console.warn('[integration] MySQL or Redis not reachable — skipping');
      return;
    }
    await Tenant.create({
      name: 'Tenant-transcript',
      slug: 'transcript-co',
      status: 'active',
      domain: null,
      expiresAt: null,
      settings: null,
    });
  }, 60_000);

  afterAll(async () => {
    if (harness !== null) await harness.cleanup();
  });

  test('emails a transcript for the visitor’s own chat', async () => {
    if (harness === null) return;
    const { app } = harness;
    const v = await initVisitor(app, 'transcript-co');
    const init = await request(app)
      .post('/api/v1/visitor/chats')
      .set('cookie', `livechat_visitor=${v.cookie}`)
      .set('X-XSRF-TOKEN', v.csrfToken)
      .send({ customerName: 'Vee', body: 'hello there' });
    expect(init.status).toBe(201);
    const chatId = init.body.data.chat.id as string;

    const ok = await request(app)
      .post(`/api/v1/visitor/chats/${chatId}/transcript`)
      .set('cookie', `livechat_visitor=${v.cookie}`)
      .set('X-XSRF-TOKEN', v.csrfToken)
      .send({ email: 'visitor@example.com' });
    expect(ok.status).toBe(200);
    expect(ok.body.success).toBe(true);
  });

  test('rejects an invalid email with 400', async () => {
    if (harness === null) return;
    const { app } = harness;
    const v = await initVisitor(app, 'transcript-co');
    const init = await request(app)
      .post('/api/v1/visitor/chats')
      .set('cookie', `livechat_visitor=${v.cookie}`)
      .set('X-XSRF-TOKEN', v.csrfToken)
      .send({ customerName: 'Vee', body: 'hi' });
    const chatId = init.body.data.chat.id as string;

    const bad = await request(app)
      .post(`/api/v1/visitor/chats/${chatId}/transcript`)
      .set('cookie', `livechat_visitor=${v.cookie}`)
      .set('X-XSRF-TOKEN', v.csrfToken)
      .send({ email: 'not-an-email' });
    expect(bad.status).toBe(400);
  });

  test('refuses a request with no CSRF token', async () => {
    if (harness === null) return;
    const { app } = harness;
    const v = await initVisitor(app, 'transcript-co');
    const init = await request(app)
      .post('/api/v1/visitor/chats')
      .set('cookie', `livechat_visitor=${v.cookie}`)
      .set('X-XSRF-TOKEN', v.csrfToken)
      .send({ customerName: 'Vee', body: 'hi' });
    const chatId = init.body.data.chat.id as string;

    // The route sends mail off the back of an ambient cookie credential, so it
    // needs the same CSRF guard as the other visitor writes (#77) — without it,
    // a cross-site page could make a visitor mail their own transcript
    // somewhere else.
    const forged = await request(app)
      .post(`/api/v1/visitor/chats/${chatId}/transcript`)
      .set('cookie', `livechat_visitor=${v.cookie}`)
      .send({ email: 'attacker@example.com' });
    expect(forged.status).toBe(403);
  });

  test('refuses another visitor’s chat with 403', async () => {
    if (harness === null) return;
    const { app } = harness;
    const a = await initVisitor(app, 'transcript-co');
    const b = await initVisitor(app, 'transcript-co');
    const initA = await request(app)
      .post('/api/v1/visitor/chats')
      .set('cookie', `livechat_visitor=${a.cookie}`)
      .set('X-XSRF-TOKEN', a.csrfToken)
      .send({ customerName: 'Aay', body: 'private' });
    const chatA = initA.body.data.chat.id as string;

    // B needs a session of their own, or this asserts nothing: under the
    // consent gate (#53) `POST /visitor/session` issues only a subject cookie,
    // so B would be refused at authentication with a 401 and never reach the
    // ownership check this test exists for. Starting a chat creates the row.
    await request(app)
      .post('/api/v1/visitor/chats')
      .set('cookie', `livechat_visitor=${b.cookie}`)
      .set('X-XSRF-TOKEN', b.csrfToken)
      .send({ customerName: 'Bee', body: 'my own chat' })
      .expect(201);

    // B presents a valid session of their own and a valid CSRF token — so this
    // is refused by the chat's ownership scope (#72), not incidentally by
    // authentication or the CSRF guard.
    const cross = await request(app)
      .post(`/api/v1/visitor/chats/${chatA}/transcript`)
      .set('cookie', `livechat_visitor=${b.cookie}`)
      .set('X-XSRF-TOKEN', b.csrfToken)
      .send({ email: 'attacker@example.com' });
    expect(cross.status).toBe(403);
  });
});
