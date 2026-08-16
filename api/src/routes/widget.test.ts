import express, { type Express } from 'express';
import { pino } from 'pino';
import { pinoHttp } from 'pino-http';
import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { errorHandler } from '../middlewares/error-handler.js';

import { buildWidgetRouter } from './widget.js';

import type { PresenceService } from '../services/index.js';
import type { Redis } from 'ioredis';

interface Captured {
  msg?: string;
  cspReport?: Record<string, unknown>;
}

/**
 * Build a minimal app that mounts only the widget router, with a pino logger
 * whose output is captured line-by-line. No DB/Redis: rate limiting is skipped,
 * and `/csp-report` touches neither.
 * @returns The app plus the array that collects parsed log lines.
 */
function buildTestApp(): { app: Express; logs: Captured[] } {
  const logs: Captured[] = [];
  const stream = {
    write(chunk: string): void {
      logs.push(JSON.parse(chunk) as Captured);
    },
  };
  const logger = pino({ level: 'info' }, stream);
  const app = express();
  app.use(express.json({ limit: '1mb' }));
  app.use(pinoHttp({ logger }));
  // `redis` is unused because skipRateLimit short-circuits the limiter, and
  // `presence` is unused because these tests only exercise `/csp-report`.
  app.use(
    '/widget',
    buildWidgetRouter({
      presence: {} as unknown as PresenceService,
      redis: {} as unknown as Redis,
      skipRateLimit: true,
    }),
  );
  app.use(errorHandler(logger));
  return { app, logs };
}

describe('POST /widget/csp-report', () => {
  it('accepts a well-formed classic report (204) and logs only whitelisted fields', async () => {
    const { app, logs } = buildTestApp();
    const res = await request(app)
      .post('/widget/csp-report')
      .set('Content-Type', 'application/csp-report')
      .send(
        JSON.stringify({
          'csp-report': {
            'document-uri': 'https://client.example.com/page',
            'violated-directive': 'script-src',
            'blocked-uri': 'https://evil.example.com/x.js',
            'original-policy': "default-src 'self'",
            'script-sample': 'alert(document.cookie)',
          },
        }),
      );

    expect(res.status).toBe(204);

    const line = logs.find((l) => l.msg === 'csp violation report');
    expect(line).toBeDefined();
    expect(line?.cspReport).toMatchObject({
      reportType: 'report-uri',
      documentUri: 'https://client.example.com/page',
      violatedDirective: 'script-src',
      blockedUri: 'https://evil.example.com/x.js',
    });
    // The sink must never echo the raw policy or the violation sample.
    const serialized = JSON.stringify(line);
    expect(serialized).not.toContain('document.cookie');
    expect(serialized).not.toContain("default-src 'self'");
  });

  it('accepts a well-formed Reporting-API report (204)', async () => {
    const { app } = buildTestApp();
    const res = await request(app)
      .post('/widget/csp-report')
      .set('Content-Type', 'application/reports+json')
      .send(
        JSON.stringify([
          {
            type: 'csp-violation',
            url: 'https://client.example.com/page',
            body: { documentURL: 'https://client.example.com/page', blockedURL: 'inline' },
          },
        ]),
      );
    expect(res.status).toBe(204);
  });

  it('rejects a body that is not shaped like a CSP report (400) and logs nothing', async () => {
    const { app, logs } = buildTestApp();
    const res = await request(app)
      .post('/widget/csp-report')
      .set('Content-Type', 'application/csp-report')
      .send(JSON.stringify({ arbitrary: 'garbage', injected: '\n\nFAKE LOG LINE' }));

    expect(res.status).toBe(400);
    expect(logs.find((l) => l.msg === 'csp violation report')).toBeUndefined();
  });

  it('rejects an over-length body (413)', async () => {
    const { app } = buildTestApp();
    const res = await request(app)
      .post('/widget/csp-report')
      .set('Content-Type', 'application/csp-report')
      .send(JSON.stringify({ 'csp-report': { 'document-uri': `https://a/${'x'.repeat(9000)}` } }));
    expect(res.status).toBe(413);
  });

  // The route parser only sees the browser content types; the app-level 1 MB
  // parser consumes `application/json` first. The Content-Length guard must keep
  // the 8 KB cap authoritative for that content type too — not silently defer to
  // the global limit.
  it('rejects an over-length application/json body (413), not the global 1mb', async () => {
    const { app, logs } = buildTestApp();
    const res = await request(app)
      .post('/widget/csp-report')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ 'csp-report': { 'document-uri': `https://a/${'x'.repeat(9000)}` } }));
    expect(res.status).toBe(413);
    expect(logs.find((l) => l.msg === 'csp violation report')).toBeUndefined();
  });

  it('accepts a small application/json report (204)', async () => {
    const { app } = buildTestApp();
    const res = await request(app)
      .post('/widget/csp-report')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ 'csp-report': { 'document-uri': 'https://client.example.com/p' } }));
    expect(res.status).toBe(204);
  });
});
