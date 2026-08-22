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

/**
 * Redis set of tenant ids that currently have at least one present visitor.
 *
 * Socket.IO's `adapter.rooms` only ever describes the *local* node, so it
 * cannot answer this question once the Redis adapter (#73) spreads visitors
 * across processes. This set is the cluster-wide answer (#125). It is written
 * alongside the per-tenant presence hash and pruned lazily on read, because the
 * hash carries a TTL and can expire without anything running to clean up
 * after it.
 */
const VISITOR_TENANTS_KEY = 'presence:visitor-tenants';

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
      const results = (await pipeline.exec()) ?? [];
      let anyLive = false;
      const dead: string[] = [];
      results.forEach(([, live], index) => {
        const member = members[index];
        if (member === undefined) return;
        if (live === 1) anyLive = true;
        else dead.push(member);
      });
      // Opportunistic cleanup: an agent who closed all tabs (connection key
      // expired) but never went 'away' would otherwise linger in the set
      // forever. Prune those stale members from both the tenant and global
      // sets — a no-op where absent, and self-healing since restoreOnConnect
      // re-adds them if they reconnect still 'available'.
      if (dead.length > 0) {
        const cleanup = deps.redis.pipeline();
        cleanup.srem(availableSetKey(tenantId), ...dead);
        cleanup.srem(availableSetKey(GLOBAL_STAFF_TENANT), ...dead);
        await cleanup.exec();
      }
      return anyLive;
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
      // Cluster-wide index of "which tenants have someone watching" (#125).
      await deps.redis.sadd(VISITOR_TENANTS_KEY, tenantId);
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
     * Tenant ids that currently have at least one connected visitor, across the
     * whole cluster.
     *
     * Reads the index set, then drops any member whose presence hash is gone —
     * the hash expires on its own TTL, so the set would otherwise accumulate
     * tenants nobody is watching any more and widen the fan-out it exists to
     * bound. Self-healing rather than requiring a sweeper.
     * @returns Distinct tenant ids with a live visitor.
     */
    async tenantsWithVisitors(): Promise<string[]> {
      const members = await deps.redis.smembers(VISITOR_TENANTS_KEY);
      if (members.length === 0) return [];
      const probe = deps.redis.pipeline();
      for (const tenantId of members) probe.exists(visitorPresenceKey(tenantId));
      const results = await probe.exec();

      const live: string[] = [];
      const stale: string[] = [];
      members.forEach((tenantId, i) => {
        // A pipeline entry is [error, value]; treat an errored probe as live so
        // a transient Redis hiccup narrows the fan-out rather than pruning a
        // tenant that is actually being watched.
        const entry = results?.[i];
        if (entry?.[0] != null || entry?.[1] === 1) live.push(tenantId);
        else stale.push(tenantId);
      });
      if (stale.length > 0) await deps.redis.srem(VISITOR_TENANTS_KEY, ...stale);
      return live;
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
