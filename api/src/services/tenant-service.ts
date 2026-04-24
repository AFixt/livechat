import { Tenant } from '../models/index.js';
import { ApiError } from '../utils/api-error.js';

import type { CreateTenantInput, UpdateTenantInput } from '@livechat/shared';

/**
 * Build the tenant service.
 * @returns An object with tenant CRUD methods.
 */
export function createTenantService() {
  return {
    /**
     * Create a tenant.
     * @param input - Validated create input.
     * @returns The created tenant.
     */
    async create(input: CreateTenantInput): Promise<Tenant> {
      const existing = await Tenant.findOne({ where: { slug: input.slug } });
      if (existing !== null) throw ApiError.conflict('Slug is already taken');
      return Tenant.create({
        name: input.name,
        slug: input.slug,
        domain: input.domain ?? null,
        expiresAt: input.expiresAt === undefined ? null : new Date(input.expiresAt),
        settings: input.settings ?? null,
      });
    },

    /**
     * List tenants (no filtering yet — admin-only endpoint).
     * @returns All tenants ordered by inc ascending.
     */
    async list(): Promise<Tenant[]> {
      return Tenant.findAll({ order: [['inc', 'ASC']] });
    },

    /**
     * Fetch a tenant by id.
     * @param id - Tenant UUID.
     * @returns The tenant.
     */
    async getById(id: string): Promise<Tenant> {
      const tenant = await Tenant.findByPk(id);
      if (tenant === null) throw ApiError.notFound('Tenant not found');
      return tenant;
    },

    /**
     * Update a tenant in place.
     * @param id - Tenant UUID.
     * @param input - Validated patch input.
     * @returns The updated tenant.
     */
    async update(id: string, input: UpdateTenantInput): Promise<Tenant> {
      const tenant = await this.getById(id);
      if (input.name !== undefined) tenant.name = input.name;
      if (input.slug !== undefined) tenant.slug = input.slug;
      if (input.domain !== undefined) tenant.domain = input.domain;
      if (input.status !== undefined) tenant.status = input.status;
      if (input.expiresAt !== undefined) {
        tenant.expiresAt = new Date(input.expiresAt);
      }
      if (input.settings !== undefined) tenant.settings = input.settings;
      await tenant.save();
      return tenant;
    },

    /**
     * Soft-delete a tenant (paranoid).
     * @param id - Tenant UUID.
     */
    async remove(id: string): Promise<void> {
      const tenant = await this.getById(id);
      await tenant.destroy();
    },
  };
}

/**
 * Shape of the tenant service.
 */
export type TenantService = ReturnType<typeof createTenantService>;
