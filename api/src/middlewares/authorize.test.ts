import { describe, expect, it, vi } from 'vitest';

import { ApiError } from '../utils/api-error.js';

import { requireRole, requireStaffOrAdmin, requireTenantAccess } from './authorize.js';

import type { User } from '../models/index.js';
import type { Request, Response } from 'express';

/**
 * Build a minimal fake User for a given role/tenant, cast to the real type so
 * call sites see the shape they expect without standing up Sequelize.
 * @param role - Role to assign.
 * @param tenantId - Tenant id, or null for tenantless accounts.
 * @returns A fake User.
 */
function fakeUser(role: User['role'], tenantId: string | null = null): User {
  return { role, tenantId } as unknown as User;
}

/**
 * Build a fake Express Request carrying only what these middlewares read.
 * @param overrides - Partial fields to set on the request.
 * @returns A fake Request.
 */
function fakeReq(overrides: {
  user?: User;
  params?: Record<string, unknown>;
  body?: unknown;
  query?: Record<string, unknown>;
}): Request {
  return {
    user: overrides.user,
    params: overrides.params ?? {},
    body: overrides.body ?? {},
    query: overrides.query ?? {},
  } as unknown as Request;
}

const res = {} as Response;

describe('requireRole', () => {
  it('calls next with 401 when no user is authenticated', () => {
    const next = vi.fn();
    const req = fakeReq({});
    requireRole('admin')(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
    const err = next.mock.calls[0]?.[0] as ApiError;
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(401);
  });

  it('calls next with 403 when the user role is not in the allowed list', () => {
    const next = vi.fn();
    const req = fakeReq({ user: fakeUser('client') });
    requireRole('admin', 'staff')(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
    const err = next.mock.calls[0]?.[0] as ApiError;
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(403);
    expect(err.message).toBe('Insufficient permissions');
  });

  it('calls next with no argument when the user role is allowed', () => {
    const next = vi.fn();
    const req = fakeReq({ user: fakeUser('admin') });
    requireRole('admin', 'staff')(req, res, next);
    expect(next).toHaveBeenCalledExactlyOnceWith();
  });
});

describe('requireStaffOrAdmin', () => {
  it.each(['super_admin', 'admin', 'staff'] as const)('allows role %s through', (role) => {
    const next = vi.fn();
    const req = fakeReq({ user: fakeUser(role) });
    requireStaffOrAdmin()(req, res, next);
    expect(next).toHaveBeenCalledExactlyOnceWith();
  });

  it('rejects a client', () => {
    const next = vi.fn();
    const req = fakeReq({ user: fakeUser('client') });
    requireStaffOrAdmin()(req, res, next);
    const err = next.mock.calls[0]?.[0] as ApiError;
    expect(err.status).toBe(403);
  });
});

describe('requireTenantAccess', () => {
  it('calls next with 401 when no user is authenticated', () => {
    const next = vi.fn();
    const req = fakeReq({});
    requireTenantAccess()(req, res, next);
    const err = next.mock.calls[0]?.[0] as ApiError;
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(401);
  });

  it.each(['super_admin', 'admin', 'staff'] as const)(
    'lets %s through regardless of tenant mismatch',
    (role) => {
      const next = vi.fn();
      const req = fakeReq({
        user: fakeUser(role, 'tenant-a'),
        params: { tenantId: 'tenant-b' },
      });
      requireTenantAccess()(req, res, next);
      expect(next).toHaveBeenCalledExactlyOnceWith();
    },
  );

  it('allows a client through when no tenantId is present anywhere on the request', () => {
    const next = vi.fn();
    const req = fakeReq({ user: fakeUser('client', 'tenant-a') });
    requireTenantAccess()(req, res, next);
    expect(next).toHaveBeenCalledExactlyOnceWith();
  });

  it('allows a client whose params.tenantId matches their own tenant', () => {
    const next = vi.fn();
    const req = fakeReq({
      user: fakeUser('client', 'tenant-a'),
      params: { tenantId: 'tenant-a' },
    });
    requireTenantAccess()(req, res, next);
    expect(next).toHaveBeenCalledExactlyOnceWith();
  });

  it('allows a client whose body.tenantId matches their own tenant', () => {
    const next = vi.fn();
    const req = fakeReq({
      user: fakeUser('client', 'tenant-a'),
      body: { tenantId: 'tenant-a' },
    });
    requireTenantAccess()(req, res, next);
    expect(next).toHaveBeenCalledExactlyOnceWith();
  });

  it('allows a client whose query.tenantId matches their own tenant', () => {
    const next = vi.fn();
    const req = fakeReq({
      user: fakeUser('client', 'tenant-a'),
      query: { tenantId: 'tenant-a' },
    });
    requireTenantAccess()(req, res, next);
    expect(next).toHaveBeenCalledExactlyOnceWith();
  });

  it('prefers params.tenantId over body/query when present', () => {
    const next = vi.fn();
    const req = fakeReq({
      user: fakeUser('client', 'tenant-a'),
      params: { tenantId: 'tenant-a' },
      body: { tenantId: 'tenant-b' },
      query: { tenantId: 'tenant-c' },
    });
    requireTenantAccess()(req, res, next);
    expect(next).toHaveBeenCalledExactlyOnceWith();
  });

  it('calls next with 403 when the resolved tenantId does not match the user tenant', () => {
    const next = vi.fn();
    const req = fakeReq({
      user: fakeUser('client', 'tenant-a'),
      params: { tenantId: 'tenant-b' },
    });
    requireTenantAccess()(req, res, next);
    const err = next.mock.calls[0]?.[0] as ApiError;
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(403);
    expect(err.message).toBe('Access denied to this tenant');
  });
});
