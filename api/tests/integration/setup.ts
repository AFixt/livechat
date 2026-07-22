import { readdir } from 'node:fs/promises';
import { createServer, type Server as HttpServer } from 'node:http';
import { type AddressInfo } from 'node:net';

import Redis, { type Redis as RedisClient } from 'ioredis';
import { pino, type Logger } from 'pino';
import { Sequelize as SequelizeLib } from 'sequelize';

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
 * A fresh test env. Defaults to a dedicated `livechat_test` database —
 * integration tests drop every table and re-run the migrations, so pointing
 * them at the shared dev `livechat_db` would wipe whatever you're working on.
 * Override `DB_NAME` to target another database.
 * @returns Env for integration testing.
 */
export function testEnv(): Env {
  return {
    NODE_ENV: 'test',
    PORT: 0,
    DB_HOST: process.env['DB_HOST'] ?? 'localhost',
    DB_PORT: process.env['DB_PORT'] === undefined ? 23307 : Number(process.env['DB_PORT']),
    DB_NAME: process.env['DB_NAME'] ?? 'livechat_test',
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

/** The shape every migration file in `src/db/migrations` exports. */
interface Migration {
  up: (
    queryInterface: ReturnType<Sequelize['getQueryInterface']>,
    sequelize: unknown,
  ) => Promise<void>;
}

const MIGRATIONS_DIR = new URL('../../src/db/migrations/', import.meta.url);

/**
 * Rebuild the schema by running the **real migrations**, not `sync()`.
 *
 * This is the point of the integration suite: `sync({ force: true })` builds
 * tables from the models, so the models can never disagree with the schema
 * under test and migration drift is invisible. Six tables once shipped without
 * the `deleted_at` column that the global `paranoid: true` default requires,
 * and every suite stayed green because none of them ever ran a migration.
 *
 * Drops every table first so each run starts from nothing and applies the full
 * migration history in filename order — the same path a real deployment takes.
 * @param sequelize - Connection to the (dedicated) test database.
 */
export async function resetSchemaFromMigrations(sequelize: Sequelize): Promise<void> {
  const queryInterface = sequelize.getQueryInterface();

  // Pin one connection for the drops: FOREIGN_KEY_CHECKS is session-scoped, so
  // toggling it on a pooled connection other than the one running the DROPs
  // would not take effect.
  await sequelize.transaction(async (transaction) => {
    const tables = await queryInterface.showAllTables({ transaction });
    await sequelize.query('SET FOREIGN_KEY_CHECKS = 0', { transaction });
    for (const table of tables) {
      await sequelize.query(`DROP TABLE IF EXISTS \`${table}\``, { transaction });
    }
    await sequelize.query('SET FOREIGN_KEY_CHECKS = 1', { transaction });
  });

  // eslint-disable-next-line security/detect-non-literal-fs-filename -- module constant, no external input
  const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith('.cjs')).sort();
  for (const file of files) {
    const loaded = (await import(new URL(file, MIGRATIONS_DIR).href)) as {
      default?: Migration;
    } & Migration;
    const migration = loaded.default ?? loaded;
    // Migrations receive the Sequelize class itself (for `Sequelize.DATE` etc.),
    // exactly as sequelize-cli passes it.
    await migration.up(queryInterface, SequelizeLib);
  }
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
  await resetSchemaFromMigrations(sequelize);
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
  const io = attachIo(httpServer, { env: base.env, logger: base.logger, services: base.services });
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
