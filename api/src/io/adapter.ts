import { createAdapter } from '@socket.io/redis-adapter';

import type { Redis } from 'ioredis';
import type { Logger } from 'pino';

/** Shared, mutable readiness flag the `/health` route reads. */
export interface AdapterHealth {
  /** True only while both the pub and sub Redis connections are ready. */
  ready: boolean;
}

/** A wired Socket.IO Redis adapter plus the handles to install and close it. */
export interface SocketRedisAdapter {
  /** Adapter constructor to hand to `io.adapter(...)`. */
  adapter: ReturnType<typeof createAdapter>;
  /** Quit both pub/sub connections — call during graceful shutdown. */
  close: () => Promise<void>;
}

/**
 * Build a Socket.IO Redis adapter so rooms and broadcasts span every API
 * instance (#73). Without it, rooms live in a single process's memory and,
 * behind a load balancer with `instance_count > 1`, roughly half of all
 * messages between a visitor and an agent on different instances are lost.
 *
 * The pub and sub clients are **duplicates** of the shared ioredis client, not
 * the client itself: a connection in subscriber mode cannot run the commands
 * the rate limiter and presence layer need on the shared client. Connection
 * state is mirrored into `health.ready` (and surfaced by `/health`), so a
 * broken adapter is visible instead of silently degrading to per-process
 * rooms.
 * @param deps - Shared redis to duplicate, logger, and the health flag to keep
 *   updated.
 * @returns The adapter constructor and a close hook for shutdown.
 */
export function createSocketRedisAdapter(deps: {
  redis: Redis;
  logger: Logger;
  health: AdapterHealth;
}): SocketRedisAdapter {
  // `lazyConnect: false` so both connect immediately and their readiness is
  // known at boot, rather than only on the first broadcast.
  const pubClient = deps.redis.duplicate({ lazyConnect: false });
  const subClient = deps.redis.duplicate({ lazyConnect: false });
  const clients: readonly [string, Redis][] = [
    ['pub', pubClient],
    ['sub', subClient],
  ];

  const refresh = (): void => {
    deps.health.ready = pubClient.status === 'ready' && subClient.status === 'ready';
  };
  for (const [name, client] of clients) {
    client.on('ready', () => {
      deps.logger.info(`socket.io redis ${name} client ready`);
      refresh();
    });
    client.on('end', () => {
      deps.logger.warn(`socket.io redis ${name} client connection closed`);
      refresh();
    });
    client.on('error', (err: Error) => {
      deps.logger.error({ err }, `socket.io redis ${name} client error`);
      deps.health.ready = false;
    });
  }

  return {
    adapter: createAdapter(pubClient, subClient),
    close: async () => {
      await Promise.allSettled([pubClient.quit(), subClient.quit()]);
    },
  };
}
