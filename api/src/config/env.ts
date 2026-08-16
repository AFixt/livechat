import { config as loadDotenv } from 'dotenv';
import { bool, cleanEnv, host, makeValidator, num, port, str, url } from 'envalid';

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

  // Visitor data retention. `VISITOR_DATA_RETENTION_DAYS` is the window after a
  // visitor session is last seen before the retention job purges it; the
  // strategy chooses whether expired sessions are anonymized (PII stripped,
  // row kept for transcript integrity) or hard-deleted (cascading to chats).
  // See docs/adr/0020-geo-retention-minimization.md and docs/privacy/.
  VISITOR_DATA_RETENTION_DAYS: num({ default: 90 }),
  VISITOR_DATA_RETENTION_STRATEGY: str({
    choices: ['anonymize', 'delete'] as const,
    default: 'anonymize' as const,
  }),
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

  // S3 is for chat attachments, which are deferred (#80) — no upload/download
  // route or UI exists. Optional so a deployment does not need credentials for
  // an absent feature; make them required again when attachments are built.
  S3_ENDPOINT: str({ default: '' }),
  S3_REGION: str({ default: 'us-east-1' }),
  S3_ACCESS_KEY: str({ default: '' }),
  S3_SECRET_KEY: str({ default: '' }),
  S3_BUCKET: str({ default: '' }),

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
  // Load a local `.env` in development so a clean clone runs after
  // `npm ci && docker compose up -d` (#81). dotenv never overrides variables
  // already set in the environment, so CI/production values always win, and
  // production must not read a file at all. `test` is excluded too: the unit
  // suite drives `process.env` directly, and reading whatever `.env` happens to
  // sit in the cwd (which the README tells contributors to create) would leak
  // values into tests and make them pass or fail based on an untracked file.
  const nodeEnv = process.env.NODE_ENV;
  if (nodeEnv !== 'production' && nodeEnv !== 'test') loadDotenv();
  return cleanEnv(process.env, envSpec);
}
