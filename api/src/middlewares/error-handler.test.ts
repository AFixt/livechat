import { pino } from 'pino';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { ApiError } from '../utils/api-error.js';

import { errorHandler } from './error-handler.js';

import type { Request, Response } from 'express';
import type { Logger } from 'pino';
import type { ZodError } from 'zod';

/**
 * A logger that records `error` calls instead of writing them.
 * @returns The stub logger and the recorded calls.
 */
function stubLogger(): { logger: Logger; errors: { err: unknown; msg: string }[] } {
  const errors: { err: unknown; msg: string }[] = [];
  const base = pino({ level: 'silent' });
  const logger = Object.create(base) as Logger;
  logger.error = ((obj: { err: unknown }, msg: string) => {
    errors.push({ err: obj.err, msg });
  }) as Logger['error'];
  return { logger, errors };
}

/**
 * Build a fake response that records `status` and `json` calls.
 * @returns The fake response plus the captured status/body.
 */
function fakeRes(): { res: Response; captured: { status?: number; body?: unknown } } {
  const captured: { status?: number; body?: unknown } = {};
  const res = {
    status: vi.fn((code: number) => {
      captured.status = code;
      return res;
    }),
    json: vi.fn((body: unknown) => {
      captured.body = body;
      return res;
    }),
  } as unknown as Response;
  return { res, captured };
}

const req = { correlationId: 'corr-1', path: '/api/v1/thing' } as unknown as Request;

describe('errorHandler', () => {
  it('serializes an ApiError with its own status and message', () => {
    const { logger, errors } = stubLogger();
    const { res, captured } = fakeRes();
    const next = vi.fn();
    errorHandler(logger)(ApiError.forbidden('nope'), req, res, next);
    expect(captured.status).toBe(403);
    expect(captured.body).toEqual({ success: false, message: 'nope' });
    expect(errors).toEqual([]);
  });

  it('includes details on the payload when the ApiError carries them', () => {
    const { logger } = stubLogger();
    const { res, captured } = fakeRes();
    const next = vi.fn();
    errorHandler(logger)(ApiError.badRequest('bad', { field: 'name' }), req, res, next);
    expect(captured.status).toBe(400);
    expect(captured.body).toEqual({
      success: false,
      message: 'bad',
      details: { field: 'name' },
    });
  });

  it('omits details when the ApiError has none', () => {
    const { logger } = stubLogger();
    const { res, captured } = fakeRes();
    const next = vi.fn();
    errorHandler(logger)(ApiError.notFound(), req, res, next);
    expect(captured.body).toEqual({ success: false, message: 'Not found' });
    expect(captured.body).not.toHaveProperty('details');
  });

  it('serializes a bare ZodError as a 400 validation failure', () => {
    const { logger, errors } = stubLogger();
    const { res, captured } = fakeRes();
    const next = vi.fn();
    const schema = z.object({ name: z.string() });
    const zodError = schema.safeParse({ name: 42 }).error as ZodError;
    errorHandler(logger)(zodError, req, res, next);
    expect(captured.status).toBe(400);
    expect(captured.body).toEqual({
      success: false,
      message: 'Validation failed',
      details: zodError.issues,
    });
    expect(errors).toEqual([]);
  });

  it('logs and returns a generic 500 for an unrecognized Error', () => {
    const { logger, errors } = stubLogger();
    const { res, captured } = fakeRes();
    const next = vi.fn();
    const boom = new Error('kaboom');
    errorHandler(logger)(boom, req, res, next);
    expect(captured.status).toBe(500);
    expect(captured.body).toEqual({ success: false, message: 'Internal server error' });
    expect(errors).toHaveLength(1);
    expect(errors[0]?.err).toBe(boom);
    expect(errors[0]?.msg).toBe('unhandled error');
  });

  it('logs and returns a generic 500 for a non-Error throw', () => {
    const { logger, errors } = stubLogger();
    const { res, captured } = fakeRes();
    const next = vi.fn();
    errorHandler(logger)('a string was thrown', req, res, next);
    expect(captured.status).toBe(500);
    expect(captured.body).toEqual({ success: false, message: 'Internal server error' });
    expect(errors).toHaveLength(1);
    expect(errors[0]?.err).toBe('a string was thrown');
    expect(errors[0]?.msg).toBe('unhandled non-error throw');
  });
});
