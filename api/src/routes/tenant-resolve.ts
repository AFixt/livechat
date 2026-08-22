import { Tenant } from '../models/index.js';
import { ApiError } from '../utils/api-error.js';

/**
 * Resolve an active tenant's id from its slug (the widget `data-tenant-key`).
 * @param tenantKey - Tenant slug.
 * @returns The tenant id.
 * @throws 400 if unknown or not active.
 */
export async function resolveActiveTenantId(tenantKey: string): Promise<string> {
  const tenant = await Tenant.findOne({
    where: { slug: tenantKey, status: 'active' },
    attributes: ['id'],
  });
  if (tenant === null) throw ApiError.badRequest('Unknown tenant');
  return tenant.id;
}
