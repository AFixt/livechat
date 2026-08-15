import { isWithinSupportHours } from './support-hours.js';

import type { SupportHours } from '@livechat/shared';
import type { Redis } from 'ioredis';

/** Explicit per-user status (never expires — survives reconnect/reload). */
const statusKey = (userId: string): string => `presence:staff:status:${userId}`;
/** Per-tenant set of user ids whose explicit status is `available`. */
const availableSetKey = (tenantId: string): string => `presence:staff:available:${tenantId}`;
/** Connection-liveness marker with a grace TTL, refreshed by connect/heartbeat. */
const connKey = (userId: string): string => `presence:staff:conn:${userId}`;

/**
 * Availability bucket for untenanted AFixt staff who serve every tenant
 * (issue #19). Their availability is unioned into every tenant's count.
 */
export const GLOBAL_STAFF_TENANT = '__global__';

/**
 * Grace window (seconds) an agent still counts as reachable after their last
 * socket connect/heartbeat. A dropped socket therefore does NOT immediately
 * mark the agent away; only a full disconnect for longer than this window
 * (all tabs closed, no heartbeat) stops them counting.
 */
const CONN_GRACE_S = 120;

/** Availability status value persisted per user. */
type StaffStatus = 'available' | 'away';

const VISITOR_PRESENCE_TTL_S = 60;

/**
 * Redis key namespace for the per-tenant visitor presence hash.
 * @param tenantId - Tenant UUID.
 * @returns The Redis key.
 */
function visitorPresenceKey(tenantId: string): string {
  return `presence:visitors:${tenantId}`;
}

interface PresenceDeps {
  redis: Redis;
}

/**
 * Build the presence service — Redis-backed staff availability (per-user, not
 * per-socket) and per-tenant visitor presence.
 * @param deps - Redis dependency.
 * @returns Presence methods.
 */
export function createPresenceService(deps: PresenceDeps) {
  /**
   * Refresh the connection-liveness marker for a user.
   * @param userId - Staff user id.
   */
  async function touchConnection(userId: string): Promise<void> {
    await deps.redis.set(connKey(userId), '1', 'EX', CONN_GRACE_S);
  }

  /**
   * Read a user's persisted status, defaulting to `away`.
   * @param userId - Staff user id.
   * @returns The stored status.
   */
  async function readStatus(userId: string): Promise<StaffStatus> {
    const raw = await deps.redis.get(statusKey(userId));
    return raw === 'available' ? 'available' : 'away';
  }

  return {
    /**
     * Set a staff user's explicit availability. Persists indefinitely so it
     * survives reconnects and reloads, and mirrors set-membership used by the
     * availability count. Also refreshes the connection marker.
     * @param userId - Staff user id.
     * @param tenantId - The user's tenant (availability is tenant-scoped).
     * @param status - `available` or `away`.
     */
    async setAvailability(userId: string, tenantId: string, status: StaffStatus): Promise<void> {
      await deps.redis.set(statusKey(userId), status);
      if (status === 'available') {
        await deps.redis.sadd(availableSetKey(tenantId), userId);
        await touchConnection(userId);
      } else {
        await deps.redis.srem(availableSetKey(tenantId), userId);
      }
    },

    /**
     * Read a staff user's persisted availability. Brand-new users (no stored
     * value) default to `away` — they opt in to `available`.
     * @param userId - Staff user id.
     * @returns The stored status, or `away` by default.
     */
    async getAvailability(userId: string): Promise<StaffStatus> {
      return readStatus(userId);
    },

    /**
     * Restore availability when a staff socket connects: keep the user's
     * persisted status (never auto-mark them available), re-assert set
     * membership if they were available, and refresh the connection marker.
     * @param userId - Staff user id.
     * @param tenantId - The user's tenant.
     * @returns The restored status.
     */
    async restoreOnConnect(userId: string, tenantId: string): Promise<StaffStatus> {
      const status = await readStatus(userId);
      if (status === 'available') await deps.redis.sadd(availableSetKey(tenantId), userId);
      await touchConnection(userId);
      return status;
    },

    /**
     * Refresh a user's connection-liveness marker. Called on a periodic
     * heartbeat from the console while a socket is open.
     * @param userId - Staff user id.
     */
    async heartbeat(userId: string): Promise<void> {
      await touchConnection(userId);
    },

    /**
     * Whether at least one agent is *explicitly available and reachable*
     * (within the connection grace window) for a tenant, and — when a
     * schedule is supplied — the tenant is currently within support hours.
     * @param tenantId - Tenant UUID.
     * @param opts - Optional support-hours schedule and evaluation instant.
     * @returns True only when support should be treated as available.
     */
    async anyStaffAvailable(
      tenantId: string,
      opts: { supportHours?: SupportHours | null; now?: Date } = {},
    ): Promise<boolean> {
      if (!isWithinSupportHours(opts.supportHours ?? null, opts.now)) return false;
      // Union the tenant's own available agents with untenanted AFixt staff,
      // who serve every tenant (issue #19).
      const members = await deps.redis.sunion(
        availableSetKey(tenantId),
        availableSetKey(GLOBAL_STAFF_TENANT),
      );
      if (members.length === 0) return false;
      const pipeline = deps.redis.pipeline();
      for (const userId of members) pipeline.exists(connKey(userId));
      const results = await pipeline.exec();
      return (results ?? []).some(([, live]) => live === 1);
    },

    /**
     * Mark a visitor as present in a tenant. TTL auto-expires the entry so
     * visitors who leave without a disconnect event eventually drop out.
     * @param tenantId - Tenant UUID.
     * @param visitorSessionId - Visitor session id.
     * @param payload - Small JSON metadata (url, ua).
     */
    async markVisitorPresent(
      tenantId: string,
      visitorSessionId: string,
      payload: Record<string, unknown>,
    ): Promise<void> {
      const key = visitorPresenceKey(tenantId);
      await deps.redis.hset(key, visitorSessionId, JSON.stringify(payload));
      await deps.redis.expire(key, VISITOR_PRESENCE_TTL_S);
    },

    /**
     * Remove a visitor from tenant presence.
     * @param tenantId - Tenant UUID.
     * @param visitorSessionId - Visitor session id.
     */
    async removeVisitor(tenantId: string, visitorSessionId: string): Promise<void> {
      await deps.redis.hdel(visitorPresenceKey(tenantId), visitorSessionId);
    },

    /**
     * Get the current visitor presence map for a tenant.
     * @param tenantId - Tenant UUID.
     * @returns Map of visitor session id to payload.
     */
    async listVisitors(tenantId: string): Promise<Record<string, Record<string, unknown>>> {
      const raw = await deps.redis.hgetall(visitorPresenceKey(tenantId));
      const out: Record<string, Record<string, unknown>> = {};
      for (const [sid, json] of Object.entries(raw)) {
        try {
          out[sid] = JSON.parse(json) as Record<string, unknown>;
        } catch {
          // skip corrupt entries
        }
      }
      return out;
    },
  };
}

/**
 * Shape of the presence service.
 */
export type PresenceService = ReturnType<typeof createPresenceService>;
