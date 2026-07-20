import { pino, type Logger, type LoggerOptions } from 'pino';

import type { Env } from './env.js';

/**
 * Build the pino logger configured for the current environment.
 * @param env - Validated env (must contain `NODE_ENV` and `LOG_LEVEL`).
 * @returns A pino logger instance.
 */
export function createLogger(env: Pick<Env, 'NODE_ENV' | 'LOG_LEVEL'>): Logger {
  const options: LoggerOptions = {
    level: env.LOG_LEVEL,
    base: { env: env.NODE_ENV },
    redact: {
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
    },
  };

  if (env.NODE_ENV === 'development') {
    options.transport = {
      target: 'pino-pretty',
      options: { translateTime: 'HH:MM:ss.l', ignore: 'pid,hostname,env' },
    };
  }

  return pino(options);
}
