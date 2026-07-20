import { getApi } from './api.js';

import type {
  CreateInvitationInput,
  CreateTenantInput,
  InvitationSafe,
  Tenant,
  UpdateTenantInput,
  UpdateUserInput,
  UserSafe,
} from '@livechat/shared';

interface Envelope<T> {
  success: boolean;
  data: T;
  message?: string;
}

/**
 * List all tenants (super_admin or admin).
 * @returns All tenants.
 */
export async function listTenants(): Promise<Tenant[]> {
  const res = await getApi().get<Envelope<Tenant[]>>('/tenants');
  return res.data.data;
}

/**
 * Create a new tenant (super_admin only).
 * @param input - Tenant creation payload.
 * @returns The created tenant.
 */
export async function createTenant(input: CreateTenantInput): Promise<Tenant> {
  const res = await getApi().post<Envelope<Tenant>>('/tenants', input);
  return res.data.data;
}

/**
 * Update an existing tenant (super_admin only).
 * @param id - Tenant UUID.
 * @param input - Patch.
 * @returns The updated tenant.
 */
export async function updateTenant(id: string, input: UpdateTenantInput): Promise<Tenant> {
  const res = await getApi().patch<Envelope<Tenant>>(`/tenants/${id}`, input);
  return res.data.data;
}

/**
 * Rotate a tenant's embed secret (super_admin only). The new secret is
 * returned exactly once — capture it and hand it off to the client's
 * backend immediately.
 * @param id - Tenant UUID.
 * @returns The new secret (raw hex).
 */
export async function rotateEmbedSecret(id: string): Promise<string> {
  const res = await getApi().post<Envelope<{ embedSecret: string }>>(
    `/tenants/${id}/rotate-embed-secret`,
    {},
  );
  return res.data.data.embedSecret;
}

/**
 * Replace the allowed-origins list for a tenant (super_admin only).
 * @param id - Tenant UUID.
 * @param origins - Origins, or null to clear.
 * @returns The updated tenant.
 */
export async function setAllowedOrigins(id: string, origins: string[] | null): Promise<Tenant> {
  const res = await getApi().put<Envelope<Tenant>>(`/tenants/${id}/allowed-origins`, {
    origins,
  });
  return res.data.data;
}

/**
 * List users (admin+). Optionally scoped to a single tenant.
 * @param tenantId - Optional tenant filter.
 * @returns Users.
 */
export async function listUsers(tenantId?: string): Promise<UserSafe[]> {
  const res = await getApi().get<Envelope<UserSafe[]>>('/users', {
    params: tenantId === undefined ? undefined : { tenantId },
  });
  return res.data.data;
}

/**
 * Update a user (admin+).
 * @param id - User UUID.
 * @param input - Patch.
 * @returns The updated user.
 */
export async function updateUser(id: string, input: UpdateUserInput): Promise<UserSafe> {
  const res = await getApi().patch<Envelope<UserSafe>>(`/users/${id}`, input);
  return res.data.data;
}

/**
 * List invitations (admin+). Optionally scoped to a tenant.
 * @param tenantId - Optional filter.
 * @returns Invitations.
 */
export async function listInvitations(tenantId?: string): Promise<InvitationSafe[]> {
  const res = await getApi().get<Envelope<InvitationSafe[]>>('/invitations', {
    params: tenantId === undefined ? undefined : { tenantId },
  });
  return res.data.data;
}

/**
 * Issue a new invitation (admin+).
 * @param input - Invitation payload.
 * @returns The new invitation.
 */
export async function createInvitation(input: CreateInvitationInput): Promise<InvitationSafe> {
  const res = await getApi().post<Envelope<InvitationSafe>>('/invitations', input);
  return res.data.data;
}

/**
 * Revoke a pending invitation (admin+).
 * @param id - Invitation UUID.
 */
export async function revokeInvitation(id: string): Promise<void> {
  await getApi().post(`/invitations/${id}/revoke`, {});
}
