import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { ApiError } from '../utils/api-error.js';

import { parsedBody, validate } from './validate.js';

import type { Request, Response } from 'express';

/**
 * Build a fake Express Request carrying only body/query/params.
 * @param overrides - Partial fields to set on the request.
 * @returns A fake Request.
 */
function fakeReq(overrides: {
  body?: unknown;
  query?: Record<string, unknown>;
  params?: Record<string, unknown>;
}): Request {
  return {
    body: overrides.body ?? {},
    query: overrides.query ?? {},
    params: overrides.params ?? {},
  } as unknown as Request;
}

const res = {} as Response;

describe('validate', () => {
  it('parses and replaces req.body when a body schema is given', () => {
    const next = vi.fn();
    const schema = z.object({ name: z.string() });
    const req = fakeReq({ body: { name: 'ada' } });
    validate({ body: schema })(req, res, next);
    expect(req.body).toEqual({ name: 'ada' });
    expect(next).toHaveBeenCalledExactlyOnceWith();
  });

  it('parses and merges req.query when a query schema is given', () => {
    const next = vi.fn();
    const schema = z.object({ page: z.coerce.number() });
    const req = fakeReq({ query: { page: '2' } });
    validate({ query: schema })(req, res, next);
    expect(req.query).toEqual({ page: 2 });
    expect(next).toHaveBeenCalledExactlyOnceWith();
  });

  it('parses and merges req.params when a params schema is given', () => {
    const next = vi.fn();
    const schema = z.object({ id: z.uuid() });
    const id = '123e4567-e89b-12d3-a456-426614174000';
    const req = fakeReq({ params: { id } });
    validate({ params: schema })(req, res, next);
    expect(req.params).toEqual({ id });
    expect(next).toHaveBeenCalledExactlyOnceWith();
  });

  it('applies body, query, and params schemas together', () => {
    const next = vi.fn();
    const req = fakeReq({
      body: { name: 'ada' },
      query: { page: '1' },
      params: { id: 'abc' },
    });
    validate({
      body: z.object({ name: z.string() }),
      query: z.object({ page: z.coerce.number() }),
      params: z.object({ id: z.string() }),
    })(req, res, next);
    expect(req.body).toEqual({ name: 'ada' });
    expect(req.query).toEqual({ page: 1 });
    expect(req.params).toEqual({ id: 'abc' });
    expect(next).toHaveBeenCalledExactlyOnceWith();
  });

  it('skips validation entirely when no schemas are given', () => {
    const next = vi.fn();
    const req = fakeReq({ body: { anything: true } });
    validate({})(req, res, next);
    expect(req.body).toEqual({ anything: true });
    expect(next).toHaveBeenCalledExactlyOnceWith();
  });

  it('calls next with a 400 ApiError carrying Zod issues when body fails validation', () => {
    const next = vi.fn();
    const schema = z.object({ name: z.string() });
    const req = fakeReq({ body: { name: 42 } });
    validate({ body: schema })(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
    const err = next.mock.calls[0]?.[0] as ApiError;
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(400);
    expect(err.message).toBe('Validation failed');
    expect(Array.isArray(err.details)).toBe(true);
  });

  it('calls next with a 400 ApiError when query fails validation', () => {
    const next = vi.fn();
    const schema = z.object({ page: z.coerce.number() });
    const req = fakeReq({ query: { page: 'not-a-number' } });
    validate({ query: schema })(req, res, next);
    const err = next.mock.calls[0]?.[0] as ApiError;
    expect(err.status).toBe(400);
  });

  it('calls next with a 400 ApiError when params fails validation', () => {
    const next = vi.fn();
    const schema = z.object({ id: z.uuid() });
    const req = fakeReq({ params: { id: 'not-a-uuid' } });
    validate({ params: schema })(req, res, next);
    const err = next.mock.calls[0]?.[0] as ApiError;
    expect(err.status).toBe(400);
  });

  it('propagates a non-Zod error thrown by a schema untouched', () => {
    const next = vi.fn();
    const boom = new Error('schema exploded');
    const schema = {
      parse: () => {
        throw boom;
      },
    } as unknown as z.ZodType;
    const req = fakeReq({ body: {} });
    validate({ body: schema })(req, res, next);
    expect(next).toHaveBeenCalledExactlyOnceWith(boom);
  });
});

describe('parsedBody', () => {
  it('returns req.body typed to the schema without re-parsing', () => {
    const schema = z.object({ name: z.string() });
    const req = { body: { name: 'ada' } };
    expect(parsedBody(req, schema)).toEqual({ name: 'ada' });
  });
});
