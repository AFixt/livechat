import { describe, expect, it, vi } from 'vitest';

import type { RequestHandler } from 'express';
import type { Redis } from 'ioredis';

/**
 * Options captured from the real `rateLimit()` call so tests can assert on
 * them without pulling in express or a live Redis connection.
 */
interface CapturedRateLimitOptions {
  windowMs: number;
  limit: number;
  standardHeaders: string;
  legacyHeaders: boolean;
  store: unknown;
}

const noopHandler: RequestHandler = (_req, _res, next) => {
  next();
};

const rateLimitMock = vi.fn((_options: CapturedRateLimitOptions): RequestHandler => noopHandler);

/**
 * Options captured from the real `RedisStore` constructor.
 */
interface CapturedStoreOptions {
  sendCommand: (command: string, ...args: (string | number | Buffer)[]) => Promise<unknown>;
  prefix: string;
}

let lastStoreOptions: CapturedStoreOptions | undefined;

class FakeRedisStore {
  public readonly options: CapturedStoreOptions;

  public constructor(options: CapturedStoreOptions) {
    this.options = options;
    lastStoreOptions = options;
  }
}

vi.mock('express-rate-limit', () => ({
  rateLimit: (options: CapturedRateLimitOptions): RequestHandler => rateLimitMock(options),
}));

vi.mock('rate-limit-redis', () => ({
  RedisStore: FakeRedisStore,
}));

const { createAuthLimiter, createGlobalLimiter, createRateLimiter } = await import(
  './rate-limit.js'
);

/**
 * Build a fake ioredis client that just records `call` invocations.
 * @returns The fake client and the list of recorded calls.
 */
function fakeRedis(): { redis: Redis; calls: unknown[][] } {
  const calls: unknown[][] = [];
  const redis = {
    call: (...args: unknown[]) => {
      calls.push(args);
      return Promise.resolve('OK');
    },
  } as unknown as Redis;
  return { redis, calls };
}

describe('createRateLimiter', () => {
  it('builds a rate limiter with the given window, max, and Redis-backed store', () => {
    rateLimitMock.mockClear();
    const { redis } = fakeRedis();
    createRateLimiter({ redis, windowMs: 1000, max: 10, prefix: 'rl:test:' });
    expect(rateLimitMock).toHaveBeenCalledTimes(1);
    const options = rateLimitMock.mock.calls[0]?.[0];
    expect(options?.windowMs).toBe(1000);
    expect(options?.limit).toBe(10);
    expect(options?.standardHeaders).toBe('draft-7');
    expect(options?.legacyHeaders).toBe(false);
    expect(options?.store).toBeInstanceOf(FakeRedisStore);
  });

  it('wires the store prefix through to RedisStore', () => {
    const { redis } = fakeRedis();
    createRateLimiter({ redis, windowMs: 1000, max: 10, prefix: 'rl:custom:' });
    expect(lastStoreOptions?.prefix).toBe('rl:custom:');
  });

  it('forwards sendCommand calls to redis.call with the command and args', async () => {
    const { redis, calls } = fakeRedis();
    createRateLimiter({ redis, windowMs: 1000, max: 10, prefix: 'rl:test:' });
    await lastStoreOptions?.sendCommand('EVALSHA', 'abc123', 1, 'key');
    expect(calls).toEqual([['EVALSHA', 'abc123', 1, 'key']]);
  });
});

describe('createGlobalLimiter', () => {
  it('configures a 300-per-15-minutes limiter under the rl:global: prefix', () => {
    rateLimitMock.mockClear();
    const { redis } = fakeRedis();
    createGlobalLimiter(redis);
    const options = rateLimitMock.mock.calls[0]?.[0];
    expect(options?.windowMs).toBe(15 * 60 * 1000);
    expect(options?.limit).toBe(300);
    expect(lastStoreOptions?.prefix).toBe('rl:global:');
  });
});

describe('createAuthLimiter', () => {
  it('configures a 5-per-15-minutes limiter under the rl:auth: prefix', () => {
    rateLimitMock.mockClear();
    const { redis } = fakeRedis();
    createAuthLimiter(redis);
    const options = rateLimitMock.mock.calls[0]?.[0];
    expect(options?.windowMs).toBe(15 * 60 * 1000);
    expect(options?.limit).toBe(5);
    expect(lastStoreOptions?.prefix).toBe('rl:auth:');
  });
});
