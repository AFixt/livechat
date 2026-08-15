import express, { type Express } from 'express';
import { pino } from 'pino';
import { pinoHttp } from 'pino-http';
import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { errorHandler } from '../middlewares/error-handler.js';

import { buildWidgetRouter } from './widget.js';

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
  // `redis` is unused because skipRateLimit short-circuits the limiter.
  app.use('/widget', buildWidgetRouter({ redis: {} as unknown as Redis, skipRateLimit: true }));
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
});
