import { createServer, type Server as HttpServer } from 'node:http';
import { type AddressInfo } from 'node:net';

import Redis, { type Redis as RedisClient } from 'ioredis';
import { pino, type Logger } from 'pino';

import { createApp } from '../../src/app.js';
import { createSequelize } from '../../src/config/mysql.js';
import { attachIo } from '../../src/io/index.js';
import { initModels } from '../../src/models/index.js';
import { createServices, type Services } from '../../src/services/index.js';

import type { Env } from '../../src/config/env.js';
import type { Express } from 'express';
import type { Sequelize } from 'sequelize';
import type { Server as IoServer } from 'socket.io';

/**
 * A fresh test env. Uses the same `livechat_db` the dev docker-compose
 * exposes — tests drop + recreate every table before running.
 * @returns Env for integration testing.
 */
export function testEnv(): Env {
  return {
    NODE_ENV: 'test',
    PORT: 0,
    DB_HOST: process.env['DB_HOST'] ?? 'localhost',
    DB_PORT: process.env['DB_PORT'] === undefined ? 23307 : Number(process.env['DB_PORT']),
    DB_NAME: process.env['DB_NAME'] ?? 'livechat_db',
    DB_USER: process.env['DB_USER'] ?? 'livechat_user',
    DB_PASS: process.env['DB_PASS'] ?? 'livechat_pass',
    REDIS_HOST: process.env['REDIS_HOST'] ?? 'localhost',
    REDIS_PORT: process.env['REDIS_PORT'] === undefined ? 26380 : Number(process.env['REDIS_PORT']),
    JWT_ACCESS_SECRET: 'test-access-secret-' + Math.random().toString(36).slice(2),
    JWT_REFRESH_SECRET: 'test-refresh-secret-' + Math.random().toString(36).slice(2),
    JWT_ACCESS_EXPIRES_IN: '15m',
    JWT_REFRESH_EXPIRES_IN: '7d',
    COOKIE_SECRET: 'test-cookie-secret-' + Math.random().toString(36).slice(2),
    APP_URL: 'http://localhost:25174',
    API_URL: 'http://localhost:23001',
    WIDGET_URL: 'http://localhost:25175',
    SMTP_HOST: 'localhost',
    SMTP_PORT: 21026,
    SMTP_FROM: 'test@example.com',
    S3_ENDPOINT: 'http://localhost:29000',
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

export interface TestHarness {
  env: Env;
  logger: Logger;
  sequelize: Sequelize;
  redis: RedisClient;
  app: Express;
  services: Services;
  cleanup: () => Promise<void>;
}

export interface LiveTestHarness extends TestHarness {
  httpServer: HttpServer;
  io: IoServer;
  baseUrl: string;
}

/**
 * Probe for a live MySQL + Redis matching {@link testEnv}. Returns `null` if
 * either is unreachable — integration tests use this to auto-skip.
 * @returns A harness if the stack is up, else `null`.
 */
export async function probeHarness(): Promise<TestHarness | null> {
  const env = testEnv();
  const logger = pino({ level: 'silent' });
  const sequelize = createSequelize(env, logger);
  const redis = new Redis({
    host: env.REDIS_HOST,
    port: env.REDIS_PORT,
    lazyConnect: true,
    maxRetriesPerRequest: 0,
    connectTimeout: 1000,
  });
  try {
    await sequelize.authenticate();
    await redis.connect();
  } catch {
    await sequelize.close().catch(() => undefined);
    await redis.quit().catch(() => undefined);
    return null;
  }

  initModels(sequelize);
  await sequelize.sync({ force: true });
  await redis.flushdb();

  const services = createServices({ env, logger, redis });
  const app = createApp({ env, logger, redis, services, skipRateLimit: true });
  return {
    env,
    logger,
    sequelize,
    redis,
    app,
    services,
    cleanup: async () => {
      await sequelize.close().catch(() => undefined);
      await redis.quit().catch(() => undefined);
    },
  };
}

/**
 * Probe + bind a real HTTP server on an ephemeral port, with Socket.IO
 * attached. Used by socket integration tests.
 * @returns A live harness or `null` if the stack isn't up.
 */
export async function probeLiveHarness(): Promise<LiveTestHarness | null> {
  const base = await probeHarness();
  if (base === null) return null;
  const httpServer = createServer(base.app);
  const io = attachIo(httpServer, { env: base.env, services: base.services });
  await new Promise<void>((resolve) => {
    httpServer.listen(0, '127.0.0.1', () => {
      resolve();
    });
  });
  const addr = httpServer.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${addr.port.toString()}`;
  return {
    ...base,
    httpServer,
    io,
    baseUrl,
    cleanup: async () => {
      await new Promise<void>((resolve) => {
        void io.close(() => {
          resolve();
        });
      });
      await new Promise<void>((resolve) => {
        httpServer.close(() => {
          resolve();
        });
      });
      await base.cleanup();
    },
  };
}
