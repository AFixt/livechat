import Redis from 'ioredis';
import { Server } from 'socket.io';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';

import { createPresenceService } from '../../src/services/presence-service.js';

import { integrationDbUp, probeHarness, testEnv } from './setup.js';

type Harness = Awaited<ReturnType<typeof probeHarness>>;

const TENANT_A = '11111111-1111-4111-8111-111111111111';
const TENANT_B = '22222222-2222-4222-8222-222222222222';

/**
 * Two presence services on separate Redis connections stand in for two API
 * processes. That is exactly the condition #125 is about: each node sees only
 * its own Socket.IO room membership, but they share Redis.
 */
describe.skipIf(!integrationDbUp)(
  'availability fan-out is cluster-wide, not per-node (#125)',
  () => {
    let harness: Harness;
    // Undefined when the harness bails (no infrastructure), which afterAll
    // must tolerate rather than throwing over the real skip reason.
    let redisA: Redis | undefined;
    let redisB: Redis | undefined;

    beforeAll(async () => {
      harness = await probeHarness();
      if (harness === null) {
        console.warn('[integration] MySQL or Redis not reachable — skipping');
        return;
      }
      const env = testEnv();
      redisA = new Redis({ host: env.REDIS_HOST, port: env.REDIS_PORT });
      redisB = new Redis({ host: env.REDIS_HOST, port: env.REDIS_PORT });
      await redisA.del('presence:visitor-tenants');
    }, 60_000);

    afterAll(async () => {
      await redisA?.quit().catch(() => undefined);
      await redisB?.quit().catch(() => undefined);
      if (harness !== null) await harness.cleanup();
    });

    test('a visitor on another node is still enumerated', async () => {
      if (harness === null) return;
      if (redisA === undefined || redisB === undefined) return;
      const nodeA = createPresenceService({ redis: redisA });
      const nodeB = createPresenceService({ redis: redisB });

      await nodeA.markVisitorPresent(TENANT_A, 'visitor-on-a', { url: 'https://a.example' });
      await nodeB.markVisitorPresent(TENANT_B, 'visitor-on-b', { url: 'https://b.example' });

      // Either node must see both tenants — this is what makes the global-staff
      // live push reach a visitor connected to a different process.
      expect((await nodeA.tenantsWithVisitors()).sort()).toEqual([TENANT_A, TENANT_B].sort());
      expect((await nodeB.tenantsWithVisitors()).sort()).toEqual([TENANT_A, TENANT_B].sort());
    });

    test('Socket.IO room membership — the old source — cannot see the other node', async () => {
      if (harness === null) return;
      // Demonstrates the defect rather than only asserting the fix. Two Socket.IO
      // servers, each with its own adapter: a room joined on one is invisible to
      // the other, which is why `adapter.rooms` was the wrong source.
      // Constructed without an http server: these never listen, so there is
      // nothing to close afterwards — only their adapters are under test.
      const nodeA = new Server();
      const nodeB = new Server();
      await nodeB.of('/visitor').adapter.addAll('socket-on-b', new Set([`tenant:${TENANT_B}`]));

      const roomsSeenByA = [...nodeA.of('/visitor').adapter.rooms.keys()];
      expect(roomsSeenByA).not.toContain(`tenant:${TENANT_B}`);
      expect([...nodeB.of('/visitor').adapter.rooms.keys()]).toContain(`tenant:${TENANT_B}`);
    });

    test('a tenant whose visitors have all gone is pruned from the index', async () => {
      if (harness === null) return;
      if (redisA === undefined) return;
      const nodeA = createPresenceService({ redis: redisA });
      // Its own tenant, so the visitors left behind by the test above cannot keep
      // this one's presence hash alive.
      const tenantC = '33333333-3333-4333-8333-333333333333';

      await nodeA.markVisitorPresent(tenantC, 'only-visitor', { url: 'https://c.example' });
      expect(await nodeA.tenantsWithVisitors()).toContain(tenantC);

      // Removing the last visitor empties the hash, and Redis drops an empty
      // hash — so the tenant must fall out of the index rather than widening the
      // fan-out it exists to bound.
      await nodeA.removeVisitor(tenantC, 'only-visitor');
      expect(await nodeA.tenantsWithVisitors()).not.toContain(tenantC);
      // Pruned from the set itself, not merely filtered on the way out.
      expect(await redisA.smembers('presence:visitor-tenants')).not.toContain(tenantC);
    });

    test('returns nothing when no visitor is present anywhere', async () => {
      if (harness === null) return;
      if (redisA === undefined) return;
      const nodeA = createPresenceService({ redis: redisA });
      await redisA.del('presence:visitor-tenants');
      expect(await nodeA.tenantsWithVisitors()).toEqual([]);
    });
  },
);
