/**
 * Central configuration for the e2e stack — dedicated ports and a dedicated
 * database, so a journey run never collides with a manually-running dev stack
 * (dev api 23001 / console 5174 / widget 5175) or the dev database.
 */
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const E2E_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Ports the Playwright-managed dev servers listen on. */
export const PORTS = {
  api: 23901,
  console: 5274,
  widget: 5275,
} as const;

export const CONSOLE_URL = `http://localhost:${String(PORTS.console)}`;
export const WIDGET_URL = `http://localhost:${String(PORTS.widget)}`;
export const API_URL = `http://localhost:${String(PORTS.api)}`;

/** MailHog HTTP API — the dev docker-compose maps the UI/API to 28026. */
export const MAILHOG_API = 'http://localhost:28026';

/** Shared infra the dev docker-compose exposes on non-default ports. */
export const DB = {
  host: 'localhost',
  port: 23307,
  name: 'livechat_e2e',
  user: 'livechat_user',
  pass: 'livechat_pass',
  rootPass: 'livechat_root_pass',
} as const;

export const REDIS = { host: 'localhost', port: 26380 } as const;

/**
 * Environment for the api server the e2e stack runs. NODE_ENV=test makes
 * server.ts skip the rate limiters, so repeated logins across a run (and CI
 * retries) never trip the auth limiter's `max: 5`.
 * @returns A process-env-shaped record for the api child process.
 */
export function apiEnv(): Record<string, string> {
  return {
    NODE_ENV: 'test',
    PORT: String(PORTS.api),
    DB_HOST: DB.host,
    DB_PORT: String(DB.port),
    DB_NAME: DB.name,
    DB_USER: DB.user,
    DB_PASS: DB.pass,
    REDIS_HOST: REDIS.host,
    REDIS_PORT: String(REDIS.port),
    JWT_ACCESS_SECRET: 'e2e-access-secret',
    JWT_REFRESH_SECRET: 'e2e-refresh-secret',
    COOKIE_SECRET: 'e2e-cookie-secret',
    APP_URL: CONSOLE_URL,
    API_URL,
    WIDGET_URL,
    SMTP_HOST: 'localhost',
    SMTP_PORT: '21026',
    S3_ENDPOINT: 'http://localhost:29000',
    S3_ACCESS_KEY: 'livechat_minio',
    S3_SECRET_KEY: 'livechat_minio_pass',
    S3_BUCKET: 'livechat-attachments',
    LOG_LEVEL: 'warn',
  };
}

/**
 * Where the per-role authenticated storage states are written. Absolute so
 * they resolve to the same place whether Playwright runs from the e2e
 * workspace or the repo root.
 */
export const STORAGE_STATE = {
  agent: resolve(E2E_DIR, '.auth/agent.json'),
  admin: resolve(E2E_DIR, '.auth/admin.json'),
} as const;
