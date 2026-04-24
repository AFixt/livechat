import { pino } from 'pino';
import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { createApp } from '../../src/app.js';

import type { Redis } from 'ioredis';
import type { Env } from '../../src/config/env.js';

function makeEnv(): Env {
  return {
    NODE_ENV: 'test',
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
    isDev: false,
    isProduction: false,
    isTest: true,
    isDevelopment: false,
  } as unknown as Env;
}

function makeStubRedis(): Redis {
  return {
    on: () => undefined,
  } as unknown as Redis;
}

describe('GET /api/v1/health', () => {
  it('returns { success: true, data: { status: "ok" } }', async () => {
    const env = makeEnv();
    const logger = pino({ level: 'silent' });
    const redis = makeStubRedis();
    const app = createApp({ env, logger, redis, skipRateLimit: true });

    const res = await request(app).get('/api/v1/health');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, data: { status: 'ok' } });
  });
});
