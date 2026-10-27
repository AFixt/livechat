import { describe, expect, it } from 'vitest';

import { assertCanChangeRole, assertCanGrantRole, type RoleGrantor } from './role-policy.js';

const TENANT = 'tenant-1';
const tenantAdmin: RoleGrantor = { id: 'admin-1', role: 'admin', tenantId: TENANT };
const globalAdmin: RoleGrantor = { id: 'admin-2', role: 'admin', tenantId: null };
const superAdmin: RoleGrantor = { id: 'super-1', role: 'super_admin', tenantId: null };

describe('assertCanGrantRole (#195)', () => {
  it('refuses a role above the grantor’s own', () => {
    expect(() => {
      assertCanGrantRole(tenantAdmin, 'super_admin', TENANT);
    }).toThrow(/above your own/);
    expect(() => {
      assertCanGrantRole(globalAdmin, 'super_admin', null);
    }).toThrow(/above your own/);
  });

  it('refuses super_admin inside a tenant, even from a super_admin', () => {
    expect(() => {
      assertCanGrantRole(superAdmin, 'super_admin', TENANT);
    }).toThrow(/tenant user cannot hold/);
  });

  it('allows a role at or below the grantor’s own', () => {
    expect(() => {
      assertCanGrantRole(tenantAdmin, 'admin', TENANT);
    }).not.toThrow();
    expect(() => {
      assertCanGrantRole(tenantAdmin, 'client', TENANT);
    }).not.toThrow();
    expect(() => {
      assertCanGrantRole(superAdmin, 'super_admin', null);
    }).not.toThrow();
  });
});

describe('assertCanChangeRole (#195)', () => {
  it('ignores a no-op role in the patch', () => {
    expect(() => {
      assertCanChangeRole(tenantAdmin, { id: 'admin-1', role: 'admin', tenantId: TENANT }, 'admin');
    }).not.toThrow();
  });

  it('refuses a change to the caller’s own role', () => {
    expect(() => {
      assertCanChangeRole(
        tenantAdmin,
        { id: 'admin-1', role: 'admin', tenantId: TENANT },
        'client',
      );
    }).toThrow(/your own role/);
  });

  it('refuses changing a user who outranks the caller', () => {
    expect(() => {
      assertCanChangeRole(
        globalAdmin,
        { id: 'super-2', role: 'super_admin', tenantId: null },
        'client',
      );
    }).toThrow(/outranks you/);
  });

  it('allows a permitted change', () => {
    expect(() => {
      assertCanChangeRole(tenantAdmin, { id: 'u-1', role: 'client', tenantId: TENANT }, 'staff');
    }).not.toThrow();
  });
});
