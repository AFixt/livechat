import { bool, cleanEnv, host, makeValidator, port, str, url } from 'envalid';

/**
 * Envalid validator for a strictly positive number of hours. Guards the
 * visitor-session TTLs: `0` would expire every session on first contact
 * (locking all visitors out), and a negative value would disable the bound
 * entirely — both are misconfigurations, not valid settings.
 */
const positiveHours = makeValidator<number>((input) => {
  const parsed = Number(input);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error('Expected a positive number of hours');
  }
  return parsed;
});

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
  // Require TLS on the DB connection. Off by default so local docker-compose
  // (plaintext) works; set DB_SSL=true in production. DB_SSL_CA carries the
  // provider's CA certificate as PEM (e.g. DigitalOcean managed MySQL) so the
  // server certificate can be verified.
  DB_SSL: bool({ default: false }),
  DB_SSL_CA: str({ default: '' }),

  REDIS_HOST: host(),
  REDIS_PORT: port({ default: 6379 }),

  JWT_ACCESS_SECRET: str(),
  JWT_REFRESH_SECRET: str(),
  JWT_ACCESS_EXPIRES_IN: str({ default: '15m' }),
  JWT_REFRESH_EXPIRES_IN: str({ default: '7d' }),

  COOKIE_SECRET: str(),

  // Visitor session lifetime, enforced server-side in `findByCookie` (#79) —
  // the cookie `maxAge` is only a client-side hint. Absolute: hard cap from
  // first contact. Idle: max gap since the last request/heartbeat. Defaults:
  // 30 days absolute, 3 days idle.
  VISITOR_SESSION_ABSOLUTE_TTL_HOURS: positiveHours({ default: 720 }),
  VISITOR_SESSION_IDLE_TTL_HOURS: positiveHours({ default: 72 }),

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
