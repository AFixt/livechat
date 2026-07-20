import Redis, { type Redis as RedisClient } from 'ioredis';

import type { Env } from './env.js';
import type { Logger } from 'pino';

/**
 * Build an ioredis client for the livechat Redis.
 * @param env - Validated env containing Redis connection vars.
 * @param logger - Pino logger; connection errors log at `error`.
 * @returns A connected (lazy) ioredis client.
 */
export function createRedis(
  env: Pick<Env, 'REDIS_HOST' | 'REDIS_PORT'>,
  logger: Logger,
): RedisClient {
  const client = new Redis({
    host: env.REDIS_HOST,
    port: env.REDIS_PORT,
    lazyConnect: true,
    maxRetriesPerRequest: 3,
    enableReadyCheck: true,
  });

  client.on('error', (error: Error) => {
    logger.error({ err: error }, 'redis error');
  });

  return client;
}
