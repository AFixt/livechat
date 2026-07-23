import { describe, expect, it, vi } from 'vitest';

import { ApiError } from '../utils/api-error.js';

import { notFoundHandler } from './not-found-handler.js';

import type { Request, Response } from 'express';

describe('notFoundHandler', () => {
  it('calls next with a 404 ApiError describing the missing route', () => {
    const next = vi.fn();
    const req = { method: 'GET', path: '/api/v1/nope' } as unknown as Request;
    const res = {} as Response;
    notFoundHandler()(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
    const err = next.mock.calls[0]?.[0] as ApiError;
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(404);
    expect(err.message).toBe('Route not found: GET /api/v1/nope');
  });

  it('reflects the actual method and path for a different route', () => {
    const next = vi.fn();
    const req = { method: 'POST', path: '/widgets' } as unknown as Request;
    const res = {} as Response;
    notFoundHandler()(req, res, next);
    const err = next.mock.calls[0]?.[0] as ApiError;
    expect(err.message).toBe('Route not found: POST /widgets');
  });
});
