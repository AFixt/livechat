import request from 'supertest';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';

import { createApp } from '../../src/app.js';
import { Tenant, VisitorSession } from '../../src/models/index.js';
import { createServices } from '../../src/services/index.js';

import { probeHarness, testEnv } from './setup.js';

import type { Env } from '../../src/config/env.js';
import type { Express } from 'express';

type Harness = Awaited<ReturnType<typeof probeHarness>>;

const COUNTRY_HEADER = 'CF-IPCountry';
const REGION_HEADER = 'CF-Region-Code';

describe('jurisdiction resolves from edge geolocation (#120)', () => {
  let harness: Harness;
  /** App configured to trust the edge geo headers. */
  let geoApp: Express;
  /** App with no geo header configured — the default. */
  let plainApp: Express;

  beforeAll(async () => {
    harness = await probeHarness();
    if (harness === null) {
      console.warn('[integration] MySQL or Redis not reachable — skipping');
      return;
    }
    const base = testEnv();
    const geoEnv = {
      ...base,
      GEO_COUNTRY_HEADER: COUNTRY_HEADER,
      GEO_REGION_HEADER: REGION_HEADER,
    } as unknown as Env;
    geoApp = createApp({
      env: geoEnv,
      logger: harness.logger,
      redis: harness.redis,
      services: createServices({ env: geoEnv, logger: harness.logger, redis: harness.redis }),
      skipRateLimit: true,
    });
    plainApp = harness.app;

    await Tenant.create({
      name: 'Tenant-geo',
      slug: 'geo-t',
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
   * Read the effective consent state for a country, via the given app.
   * @param app - The app to query.
   * @param headers - Request headers to send.
   * @param query - Query string to append.
   * @returns The response body's data member.
   */
  async function readConsent(
    app: Express,
    headers: Record<string, string>,
    query = '',
  ): Promise<{ jurisdiction: string; purposes: Record<string, string> }> {
    const res = await request(app)
      .get(`/api/v1/privacy/consent?tenantKey=geo-t${query}`)
      .set(headers);
    expect(res.status).toBe(200);
    return res.body.data as { jurisdiction: string; purposes: Record<string, string> };
  }

  test('an EU visitor resolves to the opt-in regime', async () => {
    if (harness === null) return;
    const state = await readConsent(geoApp, { [COUNTRY_HEADER]: 'DE' });
    expect(state.jurisdiction).toBe('EU');
  });

  test('a US visitor resolves to the opt-out regime, not EU', async () => {
    if (harness === null) return;
    // The whole point of #120: before this, live traffic was always UNKNOWN,
    // so a US opt-out visitor was treated as EU opt-in.
    const state = await readConsent(geoApp, { [COUNTRY_HEADER]: 'US' });
    expect(state.jurisdiction).toBe('US');
  });

  test('California is distinguished from the US at large', async () => {
    if (harness === null) return;
    const state = await readConsent(geoApp, {
      [COUNTRY_HEADER]: 'US',
      [REGION_HEADER]: 'CA',
    });
    expect(state.jurisdiction).toBe('US_CA');
  });

  test('the edge header wins over a client-supplied country', async () => {
    if (harness === null) return;
    // A visitor claiming to be in the US while the edge says Germany must not
    // be able to downgrade themselves from opt-in to opt-out.
    const state = await readConsent(geoApp, { [COUNTRY_HEADER]: 'DE' }, '&country=US');
    expect(state.jurisdiction).toBe('EU');
  });

  test('with no geo header configured, a spoofed header is ignored', async () => {
    if (harness === null) return;
    // The default deployment must not start trusting a header just because a
    // client sent one. UNKNOWN is the strict bucket, so this fails safe.
    const state = await readConsent(plainApp, { [COUNTRY_HEADER]: 'US' });
    expect(state.jurisdiction).toBe('UNKNOWN');
  });

  test('the client hint is still honored when no edge header is configured', async () => {
    if (harness === null) return;
    // Deployments without a geo header keep the pre-existing behaviour rather
    // than losing the hint entirely.
    const state = await readConsent(plainApp, {}, '&country=US');
    expect(state.jurisdiction).toBe('US');
  });

  test('the visitor session records the coarse country', async () => {
    if (harness === null) return;
    const res = await request(geoApp)
      .post('/api/v1/visitor/session')
      .set(COUNTRY_HEADER, 'FR')
      .send({ tenantKey: 'geo-t' });
    expect(res.status).toBe(201);

    const row = await VisitorSession.findByPk(res.body.data.sessionId as string);
    expect(row?.country).toBe('FR');
    // #57's minimization still applies — nothing finer than country is stored.
    expect(row?.city).toBeNull();
  });

  test('an unconfigured deployment still stores no country', async () => {
    if (harness === null) return;
    const res = await request(plainApp)
      .post('/api/v1/visitor/session')
      .set(COUNTRY_HEADER, 'FR')
      .send({ tenantKey: 'geo-t' });
    expect(res.status).toBe(201);

    const row = await VisitorSession.findByPk(res.body.data.sessionId as string);
    expect(row?.country).toBeNull();
  });
});
