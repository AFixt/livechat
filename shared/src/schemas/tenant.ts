import { z } from 'zod';

/**
 * Tenant status enum — matches the `tenants.status` ENUM column.
 */
export const tenantStatusSchema = z.enum(['active', 'suspended', 'archived']);
/**
 * Tenant status value.
 */
export type TenantStatus = z.infer<typeof tenantStatusSchema>;

/**
 * Public, safe representation of a tenant returned to clients.
 */
export const tenantSchema = z.object({
  id: z.uuid(),
  inc: z.number().int().positive(),
  name: z.string().min(1).max(255),
  slug: z
    .string()
    .min(1)
    .max(100)
    .regex(/^[a-z0-9-]+$/i),
  domain: z.string().max(255).nullable(),
  status: tenantStatusSchema,
  expiresAt: z.iso.datetime().nullable(),
  settings: z.record(z.string(), z.unknown()).nullable(),
  allowedOrigins: z.array(z.string()).nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
/**
 * Public, safe tenant object.
 */
export type Tenant = z.infer<typeof tenantSchema>;

/**
 * Input schema for `POST /tenants` — super_admin-only.
 */
export const createTenantInputSchema = z.object({
  name: z.string().min(1).max(255),
  slug: z
    .string()
    .min(1)
    .max(100)
    .regex(/^[a-z0-9-]+$/i, 'slug must be lowercase alphanumeric with hyphens'),
  domain: z.string().max(255).optional(),
  expiresAt: z.iso.datetime().optional(),
  settings: z.record(z.string(), z.unknown()).optional(),
});
/**
 * Input for creating a tenant.
 */
export type CreateTenantInput = z.infer<typeof createTenantInputSchema>;

/**
 * Input schema for `PATCH /tenants/:id`.
 */
export const updateTenantInputSchema = createTenantInputSchema.partial().extend({
  status: tenantStatusSchema.optional(),
});
/**
 * Input for updating a tenant.
 */
export type UpdateTenantInput = z.infer<typeof updateTenantInputSchema>;
