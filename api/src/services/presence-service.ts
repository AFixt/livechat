import type { Redis } from 'ioredis';

const STAFF_AVAILABLE_KEY = 'presence:staff:available';
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
 * Build the presence service.
 * @param deps - Redis dependency.
 * @returns Presence methods.
 */
export function createPresenceService(deps: PresenceDeps) {
  return {
    /**
     * Mark a staff user as available. Called when a support socket connects.
     * @param userId - Staff user id.
     */
    async setStaffAvailable(userId: string): Promise<void> {
      await deps.redis.sadd(STAFF_AVAILABLE_KEY, userId);
    },

    /**
     * Remove a staff user from availability (disconnect or manual toggle).
     * @param userId - Staff user id.
     */
    async setStaffUnavailable(userId: string): Promise<void> {
      await deps.redis.srem(STAFF_AVAILABLE_KEY, userId);
    },

    /**
     * Return whether any staff is currently available.
     * @returns True if at least one staff user is in the available set.
     */
    async anyStaffAvailable(): Promise<boolean> {
      const n = await deps.redis.scard(STAFF_AVAILABLE_KEY);
      return n > 0;
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
