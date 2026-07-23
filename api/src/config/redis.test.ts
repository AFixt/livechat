import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Logger } from 'pino';

interface CapturedRedisOptions {
  host: string;
  port: number;
  lazyConnect: boolean;
  maxRetriesPerRequest: number;
  enableReadyCheck: boolean;
}

type ErrorHandler = (error: Error) => void;

const { FakeRedis, constructed } = vi.hoisted(() => {
  const instances: {
    options: CapturedRedisOptions;
    triggerError: (error: Error) => void;
  }[] = [];

  class FakeRedisImpl {
    public readonly options: CapturedRedisOptions;
    private errorHandler: ErrorHandler | undefined;

    public constructor(options: CapturedRedisOptions) {
      this.options = options;
      instances.push(this);
    }

    public on(event: string, handler: ErrorHandler): this {
      if (event === 'error') this.errorHandler = handler;
      return this;
    }

    public triggerError(error: Error): void {
      this.errorHandler?.(error);
    }
  }

  return { FakeRedis: FakeRedisImpl, constructed: instances };
});

vi.mock('ioredis', () => ({ default: FakeRedis }));

function fakeLogger(): Logger {
  return { error: vi.fn() } as unknown as Logger;
}

describe('createRedis', () => {
  beforeEach(() => {
    constructed.length = 0;
  });

  it('builds a lazy-connect client from the given host and port', async () => {
    const { createRedis } = await import('./redis.js');
    const logger = fakeLogger();
    createRedis({ REDIS_HOST: 'redis.internal', REDIS_PORT: 6380 }, logger);
    expect(constructed).toHaveLength(1);
    expect(constructed[0]?.options).toEqual({
      host: 'redis.internal',
      port: 6380,
      lazyConnect: true,
      maxRetriesPerRequest: 3,
      enableReadyCheck: true,
    });
  });

  it('logs redis errors through the provided logger', async () => {
    const { createRedis } = await import('./redis.js');
    const logger = fakeLogger();
    createRedis({ REDIS_HOST: 'localhost', REDIS_PORT: 6379 }, logger);
    const instance = constructed[0];
    expect(instance).toBeDefined();
    const boom = new Error('connection refused');
    instance?.triggerError(boom);
    expect(logger.error).toHaveBeenCalledExactlyOnceWith({ err: boom }, 'redis error');
  });
});
