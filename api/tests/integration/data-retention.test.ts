import { pino } from 'pino';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';

import { Tenant, VisitorSession } from '../../src/models/index.js';
import { createDataRetentionService } from '../../src/services/data-retention-service.js';

import { probeHarness, type TestHarness } from './setup.js';

const logger = pino({ level: 'silent' });

/**
 * Seed a visitor session with a specific `last_seen_at`, carrying PII so the
 * anonymize/delete outcome is observable.
 * @param tenantId - Owning tenant.
 * @param cookieHash - Unique session cookie hash.
 * @param lastSeenAt - When the visitor was last seen.
 * @returns The created session id.
 */
async function seedSession(
  tenantId: string,
  cookieHash: string,
  lastSeenAt: Date,
): Promise<string> {
  const session = await VisitorSession.create({
    tenantId,
    sessionCookieHash: cookieHash,
    identityTokenSub: 'ext-user-123',
    userAgent: 'Mozilla/5.0',
    ipAddress: '203.0.113.0',
    country: 'US',
    city: null,
    language: 'en',
    currentUrl: 'https://client.example/pricing',
    referrer: 'https://google.example/',
    status: 'offline',
    firstSeenAt: lastSeenAt,
    lastSeenAt,
  });
  return session.id;
}

describe('data retention service', () => {
  let harness: TestHarness | null = null;

  beforeAll(async () => {
    harness = await probeHarness();
  });

  afterAll(async () => {
    if (harness !== null) await harness.cleanup();
  });

  test('anonymizes sessions past the window and leaves fresh ones intact', async () => {
    if (harness === null) return;
    const tenant = await Tenant.create({
      name: 'Retention Co',
      slug: `retention-anon-${Date.now().toString()}`,
      status: 'active',
      domain: null,
      expiresAt: null,
      settings: null,
    });

    const now = new Date('2026-08-15T00:00:00.000Z');
    const oldId = await seedSession(
      tenant.id,
      `old-${Date.now().toString()}`,
      new Date('2026-01-01T00:00:00.000Z'), // ~227 days old
    );
    const freshId = await seedSession(
      tenant.id,
      `fresh-${Date.now().toString()}`,
      new Date('2026-08-10T00:00:00.000Z'), // 5 days old
    );

    const retention = createDataRetentionService({ logger });
    const result = await retention.purgeExpiredVisitorData({
      retentionDays: 90,
      strategy: 'anonymize',
      now,
    });

    expect(result.anonymized).toBeGreaterThanOrEqual(1);
    expect(result.deleted).toBe(0);

    const oldRow = await VisitorSession.findByPk(oldId);
    const freshRow = await VisitorSession.findByPk(freshId);
    expect(oldRow).not.toBeNull();
    expect(oldRow?.ipAddress).toBeNull();
    expect(oldRow?.userAgent).toBeNull();
    expect(oldRow?.currentUrl).toBeNull();
    expect(oldRow?.referrer).toBeNull();
    expect(oldRow?.country).toBeNull();
    expect(oldRow?.identityTokenSub).toBeNull();

    expect(freshRow?.ipAddress).toBe('203.0.113.0');
    expect(freshRow?.currentUrl).toBe('https://client.example/pricing');
  });

  test('is idempotent — a second anonymize run over the same window is a no-op', async () => {
    if (harness === null) return;
    const tenant = await Tenant.create({
      name: 'Retention Co 2',
      slug: `retention-idem-${Date.now().toString()}`,
      status: 'active',
      domain: null,
      expiresAt: null,
      settings: null,
    });
    const now = new Date('2026-08-15T00:00:00.000Z');
    await seedSession(
      tenant.id,
      `idem-${Date.now().toString()}`,
      new Date('2026-01-01T00:00:00.000Z'),
    );
    const retention = createDataRetentionService({ logger });
    const first = await retention.purgeExpiredVisitorData({ retentionDays: 90, strategy: 'anonymize', now });
    expect(first.anonymized).toBeGreaterThanOrEqual(1);
    const second = await retention.purgeExpiredVisitorData({ retentionDays: 90, strategy: 'anonymize', now });
    expect(second.anonymized).toBe(0);
  });

  test('hard-deletes expired sessions under the delete strategy', async () => {
    if (harness === null) return;
    const tenant = await Tenant.create({
      name: 'Retention Co 3',
      slug: `retention-del-${Date.now().toString()}`,
      status: 'active',
      domain: null,
      expiresAt: null,
      settings: null,
    });
    const now = new Date('2026-08-15T00:00:00.000Z');
    const oldId = await seedSession(
      tenant.id,
      `del-old-${Date.now().toString()}`,
      new Date('2026-01-01T00:00:00.000Z'),
    );
    const freshId = await seedSession(
      tenant.id,
      `del-fresh-${Date.now().toString()}`,
      new Date('2026-08-14T00:00:00.000Z'),
    );

    const retention = createDataRetentionService({ logger });
    const result = await retention.purgeExpiredVisitorData({
      retentionDays: 90,
      strategy: 'delete',
      now,
    });

    expect(result.deleted).toBeGreaterThanOrEqual(1);
    expect(await VisitorSession.findByPk(oldId)).toBeNull();
    expect(await VisitorSession.findByPk(freshId)).not.toBeNull();
  });
});
