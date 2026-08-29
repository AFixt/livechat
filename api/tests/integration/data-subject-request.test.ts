import request from 'supertest';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';

import { createApp } from '../../src/app.js';
import {
  Chat,
  ChatMessage,
  ConsentRecord,
  Tenant,
  VisitorSession,
} from '../../src/models/index.js';
import { createServices } from '../../src/services/index.js';

import { integrationDbUp, probeHarness } from './setup.js';

import type { Env } from '../../src/config/env.js';
import type { Express } from 'express';

type Harness = Awaited<ReturnType<typeof probeHarness>>;

interface Subject {
  cookie: string;
  sessionId: string;
  chatId: string;
}

describe.skipIf(!integrationDbUp)('data-subject access and erasure (#121)', () => {
  let harness: Harness;
  let app: Express;
  /** An app configured to hard-delete rather than anonymize. */
  let deleteApp: Express;

  beforeAll(async () => {
    harness = await probeHarness();
    if (harness === null) {
      console.warn('[integration] MySQL or Redis not reachable — skipping');
      return;
    }
    app = harness.app;
    // Derived from the harness env, not a fresh `testEnv()` — that randomizes
    // COOKIE_SECRET per call, so a second app would reject the cookie the first
    // one minted.
    const env = { ...harness.env, VISITOR_DATA_RETENTION_STRATEGY: 'delete' } as unknown as Env;
    deleteApp = createApp({
      env,
      logger: harness.logger,
      redis: harness.redis,
      services: createServices({ env, logger: harness.logger, redis: harness.redis }),
      skipRateLimit: true,
    });
    await Tenant.create({
      name: 'Tenant-dsr',
      slug: 'dsr-t',
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

  /**
   * Create a visitor with a chat, a message, and a consent record.
   * @param name - Customer name, so each subject is distinguishable.
   * @returns The visitor's cookie and the ids of their rows.
   */
  async function seedSubject(name: string): Promise<Subject> {
    const boot = await request(app).post('/api/v1/visitor/session').send({ tenantKey: 'dsr-t' });
    expect(boot.status).toBe(201);
    const cookie = (boot.headers['set-cookie'] as unknown as string[])[0] ?? '';
    const csrf = boot.body.data.csrfToken as string;

    const chat = await request(app)
      .post('/api/v1/visitor/chats')
      .set('Cookie', cookie)
      .set('X-XSRF-TOKEN', csrf)
      .send({ customerName: name, body: `hello from ${name}` });
    expect(chat.status).toBe(201);

    await request(app)
      .post('/api/v1/privacy/consent')
      .set('Cookie', cookie)
      .send({ tenantKey: 'dsr-t', purposes: { presence: 'granted' } })
      .expect(201);

    // `boot.body.data.sessionId` is null whenever the consent gate suppressed
    // ambient tracking (#53) — the fail-safe Unknown jurisdiction, which is
    // every visitor without a geo header. The row still exists, because
    // starting a chat is a functional purpose and creates it; resolve the id
    // through that chat rather than from the gate's response.
    const chatId = chat.body.data.chat.id as string;
    const created = await Chat.findByPk(chatId);
    expect(created).not.toBeNull();
    return { cookie, sessionId: created!.visitorSessionId, chatId };
  }

  test('an access request returns the subject’s own data', async () => {
    if (harness === null) return;
    const subject = await seedSubject('Ada');

    const res = await request(app)
      .post('/api/v1/privacy/data-request')
      .set('Cookie', subject.cookie)
      .send({ tenantKey: 'dsr-t', type: 'export' });

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('completed');
    const data = res.body.data.data as Record<string, unknown[]>;
    expect(data.visitorSessions).toHaveLength(1);
    expect(data.chats).toHaveLength(1);
    expect(data.messages).toHaveLength(1);
    expect(data.consentRecords?.length ?? 0).toBeGreaterThan(0);
    expect(JSON.stringify(data.messages)).toContain('hello from Ada');
  });

  test('an access request returns nobody else’s data', async () => {
    if (harness === null) return;
    const mine = await seedSubject('Grace');
    await seedSubject('Alan');

    const res = await request(app)
      .post('/api/v1/privacy/data-request')
      .set('Cookie', mine.cookie)
      .send({ tenantKey: 'dsr-t', type: 'export' })
      .expect(200);

    const body = JSON.stringify(res.body.data.data);
    expect(body).toContain('hello from Grace');
    expect(body).not.toContain('hello from Alan');
  });

  test('erasure strips PII but keeps the transcript intact (anonymize)', async () => {
    if (harness === null) return;
    const subject = await seedSubject('Edsger');

    const res = await request(app)
      .post('/api/v1/privacy/data-request')
      .set('Cookie', subject.cookie)
      .send({ tenantKey: 'dsr-t', type: 'delete' });

    expect(res.status).toBe(200);
    expect(res.body.data.erased.strategy).toBe('anonymize');

    const row = await VisitorSession.findByPk(subject.sessionId);
    expect(row).not.toBeNull();
    // Every PII column cleared — the same set the retention sweep clears.
    expect(row?.ipAddress).toBeNull();
    expect(row?.userAgent).toBeNull();
    expect(row?.currentUrl).toBeNull();
    expect(row?.country).toBeNull();
    // ...but the chat survives, so transcripts stay referentially intact.
    expect(await Chat.findByPk(subject.chatId)).not.toBeNull();
  });

  test('erasure removes the consent records for that subject', async () => {
    if (harness === null) return;
    const subject = await seedSubject('Barbara');
    const before = await ConsentRecord.count();
    expect(before).toBeGreaterThan(0);

    await request(app)
      .post('/api/v1/privacy/data-request')
      .set('Cookie', subject.cookie)
      .send({ tenantKey: 'dsr-t', type: 'delete' })
      .expect(200);

    const session = await VisitorSession.findByPk(subject.sessionId);
    expect(session).not.toBeNull();
    const remaining = await ConsentRecord.findAll({
      where: { subjectKey: session!.sessionCookieHash },
    });
    expect(remaining).toHaveLength(0);
  });

  test('erasure hard-deletes when the tenant’s strategy is delete', async () => {
    if (harness === null) return;
    const subject = await seedSubject('Linus');

    const res = await request(deleteApp)
      .post('/api/v1/privacy/data-request')
      .set('Cookie', subject.cookie)
      .send({ tenantKey: 'dsr-t', type: 'delete' });

    expect(res.status).toBe(200);
    expect(res.body.data.erased.strategy).toBe('delete');
    // Hard-deleted, with the chat and its messages taken by the cascade.
    expect(await VisitorSession.findByPk(subject.sessionId, { paranoid: false })).toBeNull();
    expect(await Chat.findByPk(subject.chatId, { paranoid: false })).toBeNull();
    expect(await ChatMessage.findAll({ where: { chatId: subject.chatId } })).toHaveLength(0);
  });

  test('an erased subject exports nothing afterwards', async () => {
    if (harness === null) return;
    const subject = await seedSubject('Ken');

    await request(deleteApp)
      .post('/api/v1/privacy/data-request')
      .set('Cookie', subject.cookie)
      .send({ tenantKey: 'dsr-t', type: 'delete' })
      .expect(200);

    // The cookie no longer resolves to a session, so a follow-up access request
    // must come back empty rather than resurrecting anything.
    const res = await request(deleteApp)
      .post('/api/v1/privacy/data-request')
      .set('Cookie', subject.cookie)
      .send({ tenantKey: 'dsr-t', type: 'export' })
      .expect(200);

    const data = res.body.data.data as Record<string, unknown[]>;
    expect(data.visitorSessions).toHaveLength(0);
    expect(data.chats).toHaveLength(0);
    expect(data.messages).toHaveLength(0);
  });

  test('the request itself is audited, whatever it did', async () => {
    if (harness === null) return;
    const subject = await seedSubject('Radia');

    const res = await request(app)
      .post('/api/v1/privacy/data-request')
      .set('Cookie', subject.cookie)
      .send({ tenantKey: 'dsr-t', type: 'export' })
      .expect(200);

    // The audit row is what survives an erasure — it records that the request
    // happened without retaining the subject's data.
    const { AuditLog } = await import('../../src/models/index.js');
    const audit = await AuditLog.findOne({
      where: { resourceId: res.body.data.requestId as string },
    });
    expect(audit).not.toBeNull();
    expect(audit?.action).toBe('privacy.data_request');
  });
});
