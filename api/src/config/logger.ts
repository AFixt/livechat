import { pino, type DestinationStream, type Logger, type LoggerOptions } from 'pino';

import type { Env } from './env.js';

/**
 * Build the pino logger configured for the current environment.
 * @param env - Validated env (must contain `NODE_ENV` and `LOG_LEVEL`).
 * @param destination - Where log lines are written. Defaults to stdout; tests
 *   pass a capture stream to assert on the real serialized output.
 * @returns A pino logger instance.
 */
export function createLogger(
  env: Pick<Env, 'NODE_ENV' | 'LOG_LEVEL'>,
  destination?: DestinationStream,
): Logger {
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
        // PII backstop (#184): email addresses are never logged. Call sites
        // log an id instead; these catch one that forgets. `err.rejected`,
        // `err.rejectedErrors` and `err.response` are where nodemailer puts
        // the refused recipients and the SMTP reply that quotes them.
        'to',
        'email',
        '*.email',
        'err.rejected',
        'err.rejectedErrors',
        'err.response',
      ],
      remove: true,
    },
  };

  if (env.NODE_ENV === 'development' && destination === undefined) {
    options.transport = {
      target: 'pino-pretty',
      options: { translateTime: 'HH:MM:ss.l', ignore: 'pid,hostname,env' },
    };
  }

  return destination === undefined ? pino(options) : pino(options, destination);
}
