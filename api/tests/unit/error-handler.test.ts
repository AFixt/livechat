import express, { type Express, type Request, type Response } from 'express';
import { pino } from 'pino';
import request from 'supertest';
import { describe, expect, test } from 'vitest';

import { errorHandler } from '../../src/middlewares/error-handler.js';
import { ApiError } from '../../src/utils/api-error.js';

/**
 * A leaky secret embedded in a thrown error: fake SQL, a filesystem path, and
 * an internal hostname. The error envelope must never echo any of it.
 */
const LEAKY_MESSAGE =
  'SELECT password_hash FROM users WHERE id=1 -- /Users/afixt/api/src/db/secrets.ts @ 10.0.3.14';

/**
 * Build a throwaway Express app that exercises the real {@link errorHandler}.
 * @param jsonLimit - Body-parser size limit (kept tiny to force 413).
 * @returns A configured app with routes that throw various error shapes.
 */
function buildApp(jsonLimit = '20kb'): Express {
  const app = express();
  app.use(express.json({ limit: jsonLimit }));

  app.post('/echo', (_req: Request, res: Response) => {
    res.json({ success: true });
  });
  app.get('/throw-error', () => {
    throw new Error(LEAKY_MESSAGE);
  });
  app.get('/throw-string', (_req, _res, next) => {
    // A non-Error throw must still be caught and generalized.
    next('raw string failure: ' + LEAKY_MESSAGE);
  });
  app.get('/throw-apierror', () => {
    throw ApiError.forbidden('Insufficient permissions');
  });
  app.get('/throw-typed-no-status', () => {
    // An unrelated internal error that merely carries a string `type` (but no
    // numeric 4xx status) must NOT be mistaken for a body-parser client error.
    const e = new Error(LEAKY_MESSAGE) as Error & { type: string };
    e.type = 'some.internal.type';
    throw e;
  });

  app.use(errorHandler(pino({ level: 'silent' })));
  return app;
}

describe('errorHandler — no error leakage (unit)', () => {
  test('an unhandled Error returns a generic 500 envelope with no internals', async () => {
    const res = await request(buildApp()).get('/throw-error');
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ success: false, message: 'Internal server error' });
    // The response envelope must not leak the message, a stack, SQL, or a path.
    const serialized = JSON.stringify(res.body);
    expect(serialized).not.toContain('SELECT');
    expect(serialized).not.toContain('/Users/');
    expect(serialized).not.toContain('.ts');
    expect(serialized).not.toContain('10.0.3.14');
    expect(serialized.toLowerCase()).not.toContain('stack');
    expect(res.body).not.toHaveProperty('stack');
    expect(res.body).not.toHaveProperty('details');
  });

  test('a non-Error throw is also generalized to a 500 envelope', async () => {
    const res = await request(buildApp()).get('/throw-string');
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ success: false, message: 'Internal server error' });
    expect(JSON.stringify(res.body)).not.toContain('SELECT');
  });

  test('the generic 500 shape does not depend on NODE_ENV (no dev-only leak branch)', async () => {
    const prev = process.env['NODE_ENV'];
    for (const value of ['production', 'development']) {
      process.env['NODE_ENV'] = value;
      const res = await request(buildApp()).get('/throw-error');
      expect(res.status).toBe(500);
      expect(res.body).toEqual({ success: false, message: 'Internal server error' });
    }
    if (prev === undefined) delete process.env['NODE_ENV'];
    else process.env['NODE_ENV'] = prev;
  });

  test('an error carrying a string `type` but no numeric status stays a generic 500', async () => {
    const res = await request(buildApp()).get('/throw-typed-no-status');
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ success: false, message: 'Internal server error' });
    expect(JSON.stringify(res.body)).not.toContain('SELECT');
  });

  test('ApiError is serialized with its own status and message', async () => {
    const res = await request(buildApp()).get('/throw-apierror');
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ success: false, message: 'Insufficient permissions' });
  });
});

describe('errorHandler — malformed / oversized bodies map to 4xx (unit)', () => {
  test('malformed JSON is a 400 with a generic message, not a 500', async () => {
    const res = await request(buildApp())
      .post('/echo')
      .set('Content-Type', 'application/json')
      .send('{"tenantKey": '); // truncated / invalid JSON
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toBe('Malformed request body');
    // No fragment of the offending payload or a parser stack is echoed back.
    expect(JSON.stringify(res.body).toLowerCase()).not.toContain('json');
    expect(res.body).not.toHaveProperty('stack');
  });

  test('an oversized body is rejected with 413, not a 500', async () => {
    const big = 'x'.repeat(40 * 1024); // exceeds the 20kb test limit
    const res = await request(buildApp())
      .post('/echo')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ tenantKey: big }));
    expect(res.status).toBe(413);
    expect(res.body).toEqual({ success: false, message: 'Request payload too large' });
  });
});
