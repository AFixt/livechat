import { afterEach, describe, expect, it, vi } from 'vitest';

import { Tenant } from '../models/index.js';
import { ApiError } from '../utils/api-error.js';

import { originAllowed } from './origin-allowed.js';

import type { Request, Response } from 'express';

/**
 * Build a fake Express Request with a header lookup, query, and body.
 * @param overrides - Partial fields to set on the request.
 * @returns A fake Request.
 */
function fakeReq(overrides: {
  origin?: string;
  query?: Record<string, unknown>;
  body?: unknown;
}): Request {
  return {
    header: (name: string) => (name === 'origin' ? overrides.origin : undefined),
    query: overrides.query ?? {},
    body: overrides.body,
  } as unknown as Request;
}

const res = {} as Response;

/** Wait for the microtask queue to flush so the async IIFE inside the middleware settles. */
async function flush(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('originAllowed', () => {
  it('lets the request through when there is no Origin header', async () => {
    const findOne = vi.spyOn(Tenant, 'findOne');
    const next = vi.fn();
    const req = fakeReq({});
    originAllowed()(req, res, next);
    await flush();
    expect(next).toHaveBeenCalledExactlyOnceWith();
    expect(findOne).not.toHaveBeenCalled();
  });

  it('lets the request through when the tenant key cannot be resolved', async () => {
    const findOne = vi.spyOn(Tenant, 'findOne');
    const next = vi.fn();
    const req = fakeReq({ origin: 'https://example.com' });
    originAllowed()(req, res, next);
    await flush();
    expect(next).toHaveBeenCalledExactlyOnceWith();
    expect(findOne).not.toHaveBeenCalled();
  });

  it('resolves the tenant key from the query string', async () => {
    const findOne = vi
      .spyOn(Tenant, 'findOne')
      .mockResolvedValue({ allowedOrigins: [] } as unknown as Tenant);
    const next = vi.fn();
    const req = fakeReq({ origin: 'https://example.com', query: { tenantKey: 'acme' } });
    originAllowed()(req, res, next);
    await flush();
    expect(findOne).toHaveBeenCalledExactlyOnceWith({
      where: { slug: 'acme' },
      attributes: ['id', 'allowedOrigins'],
    });
    expect(next).toHaveBeenCalledExactlyOnceWith();
  });

  it('resolves the tenant key from the body when absent from the query', async () => {
    const findOne = vi
      .spyOn(Tenant, 'findOne')
      .mockResolvedValue({ allowedOrigins: [] } as unknown as Tenant);
    const next = vi.fn();
    const req = fakeReq({ origin: 'https://example.com', body: { tenantKey: 'acme' } });
    originAllowed()(req, res, next);
    await flush();
    expect(findOne).toHaveBeenCalledExactlyOnceWith({
      where: { slug: 'acme' },
      attributes: ['id', 'allowedOrigins'],
    });
    expect(next).toHaveBeenCalledExactlyOnceWith();
  });

  it('lets the request through when the tenant cannot be found', async () => {
    vi.spyOn(Tenant, 'findOne').mockResolvedValue(null);
    const next = vi.fn();
    const req = fakeReq({ origin: 'https://example.com', query: { tenantKey: 'ghost' } });
    originAllowed()(req, res, next);
    await flush();
    expect(next).toHaveBeenCalledExactlyOnceWith();
  });

  it('lets the request through when allowedOrigins is null (no restriction)', async () => {
    vi.spyOn(Tenant, 'findOne').mockResolvedValue({ allowedOrigins: null } as unknown as Tenant);
    const next = vi.fn();
    const req = fakeReq({ origin: 'https://example.com', query: { tenantKey: 'acme' } });
    originAllowed()(req, res, next);
    await flush();
    expect(next).toHaveBeenCalledExactlyOnceWith();
  });

  it('lets the request through when allowedOrigins is an empty array', async () => {
    vi.spyOn(Tenant, 'findOne').mockResolvedValue({ allowedOrigins: [] } as unknown as Tenant);
    const next = vi.fn();
    const req = fakeReq({ origin: 'https://example.com', query: { tenantKey: 'acme' } });
    originAllowed()(req, res, next);
    await flush();
    expect(next).toHaveBeenCalledExactlyOnceWith();
  });

  it('lets the request through when the origin is in the allowed list', async () => {
    vi.spyOn(Tenant, 'findOne').mockResolvedValue({
      allowedOrigins: ['https://example.com', 'https://other.com'],
    } as unknown as Tenant);
    const next = vi.fn();
    const req = fakeReq({ origin: 'https://example.com', query: { tenantKey: 'acme' } });
    originAllowed()(req, res, next);
    await flush();
    expect(next).toHaveBeenCalledExactlyOnceWith();
  });

  it('calls next with a 403 ApiError when the origin is not in the allowed list', async () => {
    vi.spyOn(Tenant, 'findOne').mockResolvedValue({
      allowedOrigins: ['https://other.com'],
    } as unknown as Tenant);
    const next = vi.fn();
    const req = fakeReq({ origin: 'https://example.com', query: { tenantKey: 'acme' } });
    originAllowed()(req, res, next);
    await flush();
    expect(next).toHaveBeenCalledTimes(1);
    const err = next.mock.calls[0]?.[0] as ApiError;
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(403);
    expect(err.message).toBe('Origin not allowed for this tenant');
  });

  it('calls next with the rejection reason when the tenant lookup throws', async () => {
    const boom = new Error('db unreachable');
    vi.spyOn(Tenant, 'findOne').mockRejectedValue(boom);
    const next = vi.fn();
    const req = fakeReq({ origin: 'https://example.com', query: { tenantKey: 'acme' } });
    originAllowed()(req, res, next);
    await flush();
    expect(next).toHaveBeenCalledExactlyOnceWith(boom);
  });
});
