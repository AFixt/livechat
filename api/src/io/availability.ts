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
 * Compute a tenant's aggregate support availability — explicitly-available,
 * reachable agents, gated by the tenant's configured support hours — without
 * emitting anything.
 * @param presence - Presence service.
 * @param tenantId - Tenant UUID.
 * @returns True when support should be treated as available for the tenant.
 */
async function computeTenantAvailability(
  presence: PresenceService,
  tenantId: string,
): Promise<boolean> {
  const supportHours = await loadSupportHours(tenantId);
  return presence.anyStaffAvailable(tenantId, { supportHours });
}

/**
 * Emit `support:availability_changed` for a tenant to both its visitor room and
 * its staff room.
 * @param io - Socket.IO server.
 * @param tenantId - Tenant UUID.
 * @param available - The availability value to broadcast.
 */
function emitAvailabilityChanged(io: Server, tenantId: string, available: boolean): void {
  const room = `tenant:${tenantId}`;
  io.of(VISITOR_NS).to(room).emit('support:availability_changed', { available });
  io.of(STAFF_NS).to(room).emit('support:availability_changed', { available });
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
  const available = await computeTenantAvailability(deps.presence, deps.tenantId);
  emitAvailabilityChanged(deps.io, deps.tenantId, available);
  return available;
}

/**
 * Tenant ids that currently have at least one connected visitor, read from the
 * `/visitor` namespace's room membership (`tenant:{id}` rooms). Used to bound
 * global-staff availability fan-out to tenants a live visitor could actually
 * observe a transition on.
 *
 * Note: with the default in-memory adapter this reflects the whole deployment
 * (single node). If a multi-node Redis adapter is later adopted, this only sees
 * this node's rooms — enumeration would need `adapter.allRooms()` even though
 * the room `emit` already fans out cluster-wide.
 * @param io - Socket.IO server.
 * @returns Distinct tenant ids with a connected visitor.
 */
function tenantsWithConnectedVisitors(io: Server): string[] {
  const prefix = 'tenant:';
  const ids: string[] = [];
  for (const room of io.of(VISITOR_NS).adapter.rooms.keys()) {
    if (room.startsWith(prefix)) ids.push(room.slice(prefix.length));
  }
  return ids;
}

interface GlobalBroadcastDeps<T> {
  io: Server;
  presence: PresenceService;
  /**
   * Persist the untenanted-staff availability change. Invoked between the
   * before/after snapshots so the resulting per-tenant flip can be measured.
   */
  apply: () => Promise<T>;
}

/**
 * Broadcast availability transitions caused by an untenanted "global" AFixt
 * staff member, whose status affects every tenant they serve (issue #19).
 *
 * Fan-out is bounded two ways so a single toggle never storms every tenant
 * room: we only consider tenants that currently have a connected visitor, and
 * within that set we emit only to tenants whose *effective* availability
 * actually flips as a result of `apply` (computed before/after). A toggle that
 * changes nothing observable — e.g. another available agent already covers the
 * tenant — emits nothing.
 * @param deps - Socket.IO server, presence service, and the mutation to apply.
 * @returns Whatever `apply` returns (e.g. the persisted status).
 */
export async function broadcastGlobalStaffAvailability<T>(
  deps: GlobalBroadcastDeps<T>,
): Promise<T> {
  const tenantIds = tenantsWithConnectedVisitors(deps.io);
  const before = new Map<string, boolean>();
  for (const tenantId of tenantIds) {
    before.set(tenantId, await computeTenantAvailability(deps.presence, tenantId));
  }
  const result = await deps.apply();
  for (const tenantId of tenantIds) {
    const available = await computeTenantAvailability(deps.presence, tenantId);
    if (available !== before.get(tenantId)) emitAvailabilityChanged(deps.io, tenantId, available);
  }
  return result;
}
