import { rateLimit } from 'express-rate-limit';
import { RedisStore, type SendCommandFn } from 'rate-limit-redis';

import type { RequestHandler } from 'express';
import type { Redis } from 'ioredis';

interface RateLimitOptions {
  /** Redis client used to coordinate limits across server instances. */
  redis: Redis;
  /** Window length in milliseconds. */
  windowMs: number;
  /** Maximum requests allowed per key per window. */
  max: number;
  /** Key prefix in Redis. */
  prefix: string;
}

/**
 * Build a Redis-backed rate limiter suitable for use behind a load balancer.
 * @param options - Rate limiter configuration.
 * @returns An Express middleware that returns 429 when the limit is exceeded.
 */
export function createRateLimiter(options: RateLimitOptions): RequestHandler {
  return rateLimit({
    windowMs: options.windowMs,
    limit: options.max,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    store: new RedisStore({
      sendCommand: ((command: string, ...args: (string | number | Buffer)[]) =>
        options.redis.call(command, ...args)) as SendCommandFn,
      prefix: options.prefix,
    }),
  });
}

/**
 * Global rate limiter — applied to every /api/v1 route.
 * @param redis - Shared Redis client.
 * @returns Configured Express middleware (300 requests per 15 minutes per IP).
 */
export function createGlobalLimiter(redis: Redis): RequestHandler {
  return createRateLimiter({
    redis,
    windowMs: 15 * 60 * 1000,
    max: 300,
    prefix: 'rl:global:',
  });
}

/**
 * Auth-specific limiter — applied to /auth/login, /auth/forgot-password, etc.
 * @param redis - Shared Redis client.
 * @returns Configured Express middleware (5 attempts per 15 minutes per IP).
 */
export function createAuthLimiter(redis: Redis): RequestHandler {
  return createRateLimiter({
    redis,
    windowMs: 15 * 60 * 1000,
    max: 5,
    prefix: 'rl:auth:',
  });
}
