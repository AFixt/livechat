/**
 * The deterministic dataset the e2e stack is seeded with, plus the
 * credentials the specs log in as. `seed.ts` writes exactly this; the specs
 * read from it — one source of truth so a rename can't drift them apart.
 */

/** A tenant to seed. `slug` is what the widget's `data-tenant-key` uses. */
export interface SeedTenant {
  name: string;
  slug: string;
}

/** A user to seed. Passwords are plain here; the model hashes on create. */
export interface SeedUser {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  role: 'super_admin' | 'admin' | 'staff' | 'client';
  status: 'active' | 'suspended' | 'pending' | 'deactivated';
  /** Tenant slug, or null for AFixt-wide accounts. */
  tenantSlug: string | null;
}

export const TENANTS = {
  acme: { name: 'Acme Corp', slug: 'acme' },
  globex: { name: 'Globex Industries', slug: 'globex' },
} as const satisfies Record<string, SeedTenant>;

export const USERS = {
  /** AFixt super admin — drives the admin console. */
  superAdmin: {
    email: 'super@afixt.com',
    password: 'SuperSecret123!',
    firstName: 'Super',
    lastName: 'Admin',
    role: 'super_admin',
    status: 'active',
    tenantSlug: null,
  },
  /**
   * The support agent — tenanted to acme so it joins the `tenant:{id}` socket
   * room and receives that tenant's real-time events (see issue #19).
   */
  agent: {
    email: 'staff@acme.example',
    password: 'Staff!Password1',
    firstName: 'Stella',
    lastName: 'Staff',
    role: 'staff',
    status: 'active',
    tenantSlug: 'acme',
  },
  /** A tenant-scoped admin, for admin-console listing assertions. */
  acmeAdmin: {
    email: 'alice@acme.example.com',
    password: 'SuperSecret123!',
    firstName: 'Alice',
    lastName: 'Anderson',
    role: 'admin',
    status: 'active',
    tenantSlug: 'acme',
  },
  /** A suspended staff member — used to assert login is refused. */
  suspended: {
    email: 'bob@globex.example.com',
    password: 'SuperSecret123!',
    firstName: 'Bob',
    lastName: 'Baker',
    role: 'staff',
    status: 'suspended',
    tenantSlug: 'globex',
  },
} as const satisfies Record<string, SeedUser>;

/** A pending invitation seeded so the admin invitations list has a row. */
export const PENDING_INVITATION = {
  email: 'carol@acme.example.com',
  role: 'staff',
  tenantSlug: 'acme',
  token: 'e2e-seed-invitation-token-0001',
} as const;
