import { describe, expect, it, vi } from 'vitest';

import type { LoggerOptions } from 'pino';

const { pinoMock } = vi.hoisted(() => ({
  pinoMock: vi.fn((options: LoggerOptions) => ({ __options: options })),
}));

vi.mock('pino', () => ({
  pino: (options: LoggerOptions) => pinoMock(options),
}));

describe('createLogger', () => {
  it('sets the level from env.LOG_LEVEL', async () => {
    const { createLogger } = await import('./logger.js');
    pinoMock.mockClear();
    createLogger({ NODE_ENV: 'production', LOG_LEVEL: 'warn' });
    expect(pinoMock).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ level: 'warn' }));
  });

  it('redacts sensitive fields and removes them entirely', async () => {
    const { createLogger } = await import('./logger.js');
    pinoMock.mockClear();
    createLogger({ NODE_ENV: 'test', LOG_LEVEL: 'error' });
    const options = pinoMock.mock.calls[0]?.[0];
    expect(options?.redact).toEqual({
      paths: [
        'req.headers.authorization',
        'req.headers.cookie',
        'req.headers["x-xsrf-token"]',
        'password',
        'password_hash',
        'token',
        'refreshToken',
        'accessToken',
      ],
      remove: true,
    });
  });

  it('does not attach a pretty-print transport outside development', async () => {
    const { createLogger } = await import('./logger.js');
    pinoMock.mockClear();
    createLogger({ NODE_ENV: 'production', LOG_LEVEL: 'info' });
    const options = pinoMock.mock.calls[0]?.[0];
    expect(options?.transport).toBeUndefined();
  });

  it('attaches the pino-pretty transport in development', async () => {
    const { createLogger } = await import('./logger.js');
    pinoMock.mockClear();
    createLogger({ NODE_ENV: 'development', LOG_LEVEL: 'debug' });
    const options = pinoMock.mock.calls[0]?.[0];
    expect(options?.transport).toEqual({
      target: 'pino-pretty',
      options: { translateTime: 'HH:MM:ss.l', ignore: 'pid,hostname,env' },
    });
  });

  it('carries NODE_ENV through as base.env', async () => {
    const { createLogger } = await import('./logger.js');
    pinoMock.mockClear();
    createLogger({ NODE_ENV: 'test', LOG_LEVEL: 'info' });
    const options = pinoMock.mock.calls[0]?.[0];
    expect(options?.base).toEqual({ env: 'test' });
  });
});
