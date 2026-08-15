import { Tenant } from '../models/index.js';
import { parseSupportHours } from '../services/support-hours.js';

import type { PresenceService } from '../services/index.js';
import type { Server } from 'socket.io';

const STAFF_NS = '/staff';
const VISITOR_NS = '/visitor';

/**
 * Load a tenant's configured support-hours schedule from its `settings` JSON.
 * @param tenantId - Tenant UUID.
 * @returns The parsed schedule, or `null` when unconfigured/unknown.
 */
export async function loadSupportHours(
  tenantId: string,
): Promise<ReturnType<typeof parseSupportHours>> {
  const tenant = await Tenant.findByPk(tenantId, { attributes: ['settings'] });
  return parseSupportHours(tenant?.settings?.supportHours);
}

interface BroadcastDeps {
  io: Server;
  presence: PresenceService;
  tenantId: string;
}

/**
 * Recompute a tenant's aggregate support availability (explicitly-available
 * agents, gated by support hours) and broadcast `support:availability_changed`
 * to that tenant's visitor room and staff room. This is the bridge that makes
 * the widget's invitation (§5.1.2) and no-support (§5.1.4) states reachable.
 * @param deps - Socket.IO server, presence service, and the tenant to update.
 * @returns The computed availability that was broadcast.
 */
export async function broadcastTenantAvailability(deps: BroadcastDeps): Promise<boolean> {
  const supportHours = await loadSupportHours(deps.tenantId);
  const available = await deps.presence.anyStaffAvailable(deps.tenantId, { supportHours });
  const room = `tenant:${deps.tenantId}`;
  deps.io.of(VISITOR_NS).to(room).emit('support:availability_changed', { available });
  deps.io.of(STAFF_NS).to(room).emit('support:availability_changed', { available });
  return available;
}
