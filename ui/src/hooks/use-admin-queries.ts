import { useMutation, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';

import {
  createInvitation,
  createTenant,
  listInvitations,
  listTenants,
  listUsers,
  revokeInvitation,
  rotateEmbedSecret,
  setAllowedOrigins,
  updateTenant,
  updateUser,
} from '../services/admin-api.js';

import type {
  CreateInvitationInput,
  CreateTenantInput,
  InvitationSafe,
  Tenant,
  UpdateTenantInput,
  UpdateUserInput,
  UserSafe,
} from '@livechat/shared';

const KEYS = {
  tenants: ['tenants'] as const,
  users: (tenantId?: string) => ['users', tenantId ?? null] as const,
  invitations: (tenantId?: string) => ['invitations', tenantId ?? null] as const,
};

/**
 * Fetch the tenant list with React Query.
 * @returns The query result.
 */
export function useTenants(): UseQueryResult<Tenant[]> {
  return useQuery({ queryKey: KEYS.tenants, queryFn: listTenants });
}

/**
 * Fetch users, optionally scoped to a tenant.
 * @param tenantId - Optional filter.
 * @returns The query result.
 */
export function useUsers(tenantId?: string): UseQueryResult<UserSafe[]> {
  return useQuery({
    queryKey: KEYS.users(tenantId),
    queryFn: () => listUsers(tenantId),
  });
}

/**
 * Fetch invitations, optionally scoped to a tenant.
 * @param tenantId - Optional filter.
 * @returns The query result.
 */
export function useInvitations(tenantId?: string): UseQueryResult<InvitationSafe[]> {
  return useQuery({
    queryKey: KEYS.invitations(tenantId),
    queryFn: () => listInvitations(tenantId),
  });
}

/**
 * Mutation: create a tenant. Invalidates the tenants list on success.
 * @returns The mutation.
 */
export function useCreateTenant() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateTenantInput) => createTenant(input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: KEYS.tenants });
    },
  });
}

/**
 * Mutation: patch a tenant. Invalidates the tenants list on success.
 * @returns The mutation.
 */
export function useUpdateTenant() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: { id: string; input: UpdateTenantInput }) =>
      updateTenant(args.id, args.input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: KEYS.tenants });
    },
  });
}

/**
 * Mutation: rotate a tenant's embed secret. Returns the new secret (once).
 * @returns The mutation.
 */
export function useRotateEmbedSecret() {
  return useMutation({ mutationFn: (id: string) => rotateEmbedSecret(id) });
}

/**
 * Mutation: replace a tenant's allowed-origins list.
 * @returns The mutation.
 */
export function useSetAllowedOrigins() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: { id: string; origins: string[] | null }) =>
      setAllowedOrigins(args.id, args.origins),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: KEYS.tenants });
    },
  });
}

/**
 * Mutation: patch a user. Invalidates all user lists.
 * @returns The mutation.
 */
export function useUpdateUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: { id: string; input: UpdateUserInput }) => updateUser(args.id, args.input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['users'] });
    },
  });
}

/**
 * Mutation: issue a new invitation.
 * @returns The mutation.
 */
export function useCreateInvitation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateInvitationInput) => createInvitation(input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['invitations'] });
    },
  });
}

/**
 * Mutation: revoke a pending invitation.
 * @returns The mutation.
 */
export function useRevokeInvitation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => revokeInvitation(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['invitations'] });
    },
  });
}
