import { describe, expect, it, vi } from 'vitest';

import { ApiError } from '../utils/api-error.js';

import {
  assertTenantAccess,
  callerTenantScope,
  requireRole,
  requireStaffOrAdmin,
  resolveTenantFilter,
} from './authorize.js';

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

describe('callerTenantScope', () => {
  it('returns undefined for an untenanted AFixt staff account', () => {
    expect(callerTenantScope(fakeReq({ user: fakeUser('super_admin', null) }))).toBeUndefined();
  });

  it('returns undefined when nobody is authenticated', () => {
    expect(callerTenantScope(fakeReq({}))).toBeUndefined();
  });

  it('returns the tenant a scoped caller is confined to', () => {
    expect(callerTenantScope(fakeReq({ user: fakeUser('admin', 'tenant-a') }))).toBe('tenant-a');
  });
});

describe('assertTenantAccess', () => {
  it('permits an untenanted caller to touch any tenant', () => {
    const req = fakeReq({ user: fakeUser('super_admin', null) });
    expect(() => {
      assertTenantAccess(req, 'tenant-b');
    }).not.toThrow();
  });

  it('permits a scoped caller to touch their own tenant', () => {
    const req = fakeReq({ user: fakeUser('staff', 'tenant-a') });
    expect(() => {
      assertTenantAccess(req, 'tenant-a');
    }).not.toThrow();
  });

  it('rejects a scoped caller touching another tenant', () => {
    const req = fakeReq({ user: fakeUser('admin', 'tenant-a') });
    expect(() => {
      assertTenantAccess(req, 'tenant-b');
    }).toThrow(ApiError);
  });

  it('rejects a scoped caller when the resource has no tenant at all', () => {
    const req = fakeReq({ user: fakeUser('admin', 'tenant-a') });
    let thrown: unknown;
    try {
      assertTenantAccess(req, null);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(ApiError);
    expect((thrown as ApiError).status).toBe(403);
  });
});

describe('resolveTenantFilter', () => {
  it('lets an untenanted caller ask for any single tenant', () => {
    const req = fakeReq({ user: fakeUser('super_admin', null) });
    expect(resolveTenantFilter(req, 'tenant-b')).toBe('tenant-b');
  });

  it('lets an untenanted caller ask for every tenant', () => {
    const req = fakeReq({ user: fakeUser('super_admin', null) });
    expect(resolveTenantFilter(req, undefined)).toBeUndefined();
  });

  it('pins a scoped caller to their own tenant when they ask for nothing', () => {
    const req = fakeReq({ user: fakeUser('admin', 'tenant-a') });
    expect(resolveTenantFilter(req, undefined)).toBe('tenant-a');
  });

  it('pins a scoped caller to their own tenant when they ask for it explicitly', () => {
    const req = fakeReq({ user: fakeUser('admin', 'tenant-a') });
    expect(resolveTenantFilter(req, 'tenant-a')).toBe('tenant-a');
  });

  it('ignores a non-string filter and still pins a scoped caller', () => {
    const req = fakeReq({ user: fakeUser('admin', 'tenant-a') });
    expect(resolveTenantFilter(req, 42)).toBe('tenant-a');
  });

  it('rejects a scoped caller explicitly asking for another tenant', () => {
    const req = fakeReq({ user: fakeUser('admin', 'tenant-a') });
    let thrown: unknown;
    try {
      resolveTenantFilter(req, 'tenant-b');
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(ApiError);
    expect((thrown as ApiError).status).toBe(403);
  });
});
