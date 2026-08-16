import { pino } from 'pino';
import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { createApp } from '../../src/app.js';
import { createServices } from '../../src/services/index.js';

import type { Env } from '../../src/config/env.js';
import type { Express } from 'express';
import type { Redis } from 'ioredis';

/**
 * Build a test env pinned to a given `NODE_ENV`.
 * @param nodeEnv - The environment to simulate.
 * @returns A fully-populated {@link Env}.
 */
function makeEnv(nodeEnv: Env['NODE_ENV']): Env {
  return {
    NODE_ENV: nodeEnv,
    PORT: 0,
    DB_HOST: 'localhost',
    DB_PORT: 3306,
    DB_NAME: 'livechat_test',
    DB_USER: 'test',
    DB_PASS: 'test',
    REDIS_HOST: 'localhost',
    REDIS_PORT: 6379,
    JWT_ACCESS_SECRET: 'test-access-secret',
    JWT_REFRESH_SECRET: 'test-refresh-secret',
    JWT_ACCESS_EXPIRES_IN: '15m',
    JWT_REFRESH_EXPIRES_IN: '7d',
    COOKIE_SECRET: 'test-cookie-secret',
    APP_URL: 'http://localhost:25174',
    API_URL: 'http://localhost:23001',
    WIDGET_URL: 'http://localhost:25175',
    SMTP_HOST: 'localhost',
    SMTP_PORT: 1025,
    SMTP_FROM: 'test@example.com',
    S3_ENDPOINT: 'http://localhost:9000',
    S3_REGION: 'us-east-1',
    S3_ACCESS_KEY: 'test',
    S3_SECRET_KEY: 'test',
    S3_BUCKET: 'test',
    LOG_LEVEL: 'silent' as Env['LOG_LEVEL'],
    isDev: nodeEnv === 'development',
    isProduction: nodeEnv === 'production',
    isTest: nodeEnv === 'test',
    isDevelopment: nodeEnv === 'development',
  } as unknown as Env;
}

/**
 * A no-op redis stub — the docs routes never touch redis, and rate limiting is
 * skipped, so nothing more is needed.
 * @returns A minimal Redis-shaped stub.
 */
function makeStubRedis(): Redis {
  return { on: () => undefined } as unknown as Redis;
}

/**
 * Build the app for a given environment with rate limiting skipped.
 * @param nodeEnv - The environment to simulate.
 * @returns The Express app.
 */
function buildApp(nodeEnv: Env['NODE_ENV']): Express {
  const env = makeEnv(nodeEnv);
  const logger = pino({ level: 'silent' });
  const redis = makeStubRedis();
  const services = createServices({ env, logger, redis });
  return createApp({ env, logger, redis, services, skipRateLimit: true });
}

describe('OpenAPI docs gating (#78)', () => {
  it('serves Swagger UI and the raw spec outside production', async () => {
    const app = buildApp('development');

    const spec = await request(app).get('/api/docs.json');
    expect(spec.status).toBe(200);
    expect(spec.body).toHaveProperty('openapi');

    // swagger-ui-express serves the HTML at the trailing-slash path.
    const ui = await request(app).get('/api/docs/');
    expect(ui.status).toBe(200);
  });

  it('returns 404 for the docs UI and raw spec in production', async () => {
    const app = buildApp('production');

    expect((await request(app).get('/api/docs.json')).status).toBe(404);
    expect((await request(app).get('/api/docs/')).status).toBe(404);
    expect((await request(app).get('/api/docs')).status).toBe(404);
  });
});
