import { cleanEnv, host, port, str, url } from 'envalid';

/**
 * Env spec used by {@link loadEnv}.
 * @remarks
 * Kept as a const so the return type of `cleanEnv` infers precisely.
 */
const envSpec = {
  NODE_ENV: str({
    choices: ['development', 'production', 'test'] as const,
    default: 'development' as const,
  }),
  PORT: port({ default: 3000 }),

  DB_HOST: host(),
  DB_PORT: port({ default: 3306 }),
  DB_NAME: str(),
  DB_USER: str(),
  DB_PASS: str(),

  REDIS_HOST: host(),
  REDIS_PORT: port({ default: 6379 }),

  JWT_ACCESS_SECRET: str(),
  JWT_REFRESH_SECRET: str(),
  JWT_ACCESS_EXPIRES_IN: str({ default: '15m' }),
  JWT_REFRESH_EXPIRES_IN: str({ default: '7d' }),

  COOKIE_SECRET: str(),

  APP_URL: url(),
  API_URL: url(),
  WIDGET_URL: url(),

  SMTP_HOST: host(),
  SMTP_PORT: port({ default: 1025 }),
  SMTP_FROM: str({ default: 'no-reply@livechat.afixt.com' }),

  S3_ENDPOINT: str({ default: '' }),
  S3_REGION: str({ default: 'us-east-1' }),
  S3_ACCESS_KEY: str(),
  S3_SECRET_KEY: str(),
  S3_BUCKET: str(),

  LOG_LEVEL: str({
    choices: ['trace', 'debug', 'info', 'warn', 'error', 'fatal'] as const,
    default: 'info' as const,
  }),
};

/**
 * Validated, typed environment configuration.
 * @remarks
 * Call {@link loadEnv} at process boot. Never read `process.env` directly
 * elsewhere — consumers should receive the typed object via dependency
 * injection so tests can swap it out.
 */
export type Env = Readonly<ReturnType<typeof loadEnv>>;

/**
 * Validate `process.env` against {@link envSpec} and return a typed object.
 * @returns The validated env, frozen (envalid freezes by default).
 * @throws If any required env var is missing or malformed — envalid prints a
 *   helpful error and exits the process.
 */
export function loadEnv(): ReturnType<typeof cleanEnv<typeof envSpec>> {
  return cleanEnv(process.env, envSpec);
}
