import { createServer, type Server as HttpServer } from 'node:http';
import { type AddressInfo } from 'node:net';

import Redis, { type Redis as RedisClient } from 'ioredis';
import { pino, type Logger } from 'pino';

import { createApp } from '../../src/app.js';
import { createSequelize } from '../../src/config/mysql.js';
import { resetSchemaFromMigrations } from '../../src/db/migrator.js';
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
    // Jurisdiction comes from a trusted edge header, never the request body
    // (#53). Tests set `x-geo-country` to model an edge that resolved one.
    GEO_COUNTRY_HEADER: 'x-geo-country',
    GEO_REGION_HEADER: 'x-geo-region',
    VISITOR_SESSION_ABSOLUTE_TTL_HOURS: 720,
    VISITOR_SESSION_IDLE_TTL_HOURS: 72,
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
 * True when running without the stack was explicitly requested. This is the
 * only condition under which an unreachable MySQL/Redis is tolerated — and
 * then the tests are reported as skipped, never passed.
 * @returns Whether `INTEGRATION_DB_OPTIONAL=1` is set.
 */
function stackIsOptional(): boolean {
  return process.env['INTEGRATION_DB_OPTIONAL'] === '1';
}

/**
 * The operator-facing explanation for an unreachable stack.
 * @param env - The env whose endpoints were probed.
 * @param cause - The underlying connection error.
 * @returns A message naming the endpoints, the fix, and the opt-out.
 */
function unreachableMessage(env: Env, cause: unknown): string {
  return (
    'Integration stack unreachable — ' +
    `MySQL ${env.DB_HOST}:${String(env.DB_PORT)}/${env.DB_NAME}, ` +
    `Redis ${env.REDIS_HOST}:${String(env.REDIS_PORT)}. ` +
    'Start it with `docker compose up -d mysql redis`, or set ' +
    'INTEGRATION_DB_OPTIONAL=1 to run without it (integration tests are then ' +
    'reported as skipped — never as passed). ' +
    `Cause: ${cause instanceof Error ? cause.message : String(cause)}`
  );
}

/**
 * Connect to MySQL + Redis exactly as {@link probeHarness} would, then
 * disconnect. Used once at module load so the result is known at collection
 * time, where `describe.skipIf` can consult it.
 * @returns Whether both are reachable.
 * @throws When unreachable and running without the stack was not requested —
 * absent infrastructure must read as a failure, not a pass (#170).
 */
async function probeStack(): Promise<boolean> {
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
    return true;
  } catch (error) {
    if (!stackIsOptional()) throw new Error(unreachableMessage(env, error));
    return false;
  } finally {
    await sequelize.close().catch(() => undefined);
    await redis.quit().catch(() => undefined);
  }
}

/**
 * Whether the integration stack was reachable at module load. Every
 * integration test file gates its top-level `describe` on this via
 * `describe.skipIf(!integrationDbUp)`, so a missing stack shows up in the run
 * summary as skipped tests. Before this existed, per-test `harness === null`
 * early returns reported the same condition as *passed* — a green run that
 * asserted nothing (#170). Resolved with top-level await so the value is
 * final before collection; when the stack is down and
 * `INTEGRATION_DB_OPTIONAL=1` was not set, module evaluation throws instead
 * and the whole file fails loudly.
 */
export const integrationDbUp: boolean = await probeStack();

/**
 * Probe for a live MySQL + Redis matching {@link testEnv} and build an app
 * harness against it.
 * @returns A harness if the stack is up; `null` only when
 * `INTEGRATION_DB_OPTIONAL=1` and the stack went away after module load.
 * @throws When the stack is unreachable and running without it was not
 * requested.
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
  } catch (error) {
    await sequelize.close().catch(() => undefined);
    await redis.quit().catch(() => undefined);
    // The module-load gate above already decided reachability; landing here
    // means the stack died between collection and this file's beforeAll. Same
    // rule applies: only an explicit opt-out may swallow it.
    if (!stackIsOptional()) throw new Error(unreachableMessage(env, error));
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
 * Poll a namespace's adapter until `room` holds at least `size` members.
 *
 * Socket tests used to sleep a fixed 150ms after emitting a join-inducing
 * event and hope the server handler had finished — a wall-clock race that
 * loses on a loaded runner (`chat:accept` awaits a MySQL update before its
 * `socket.join`, observed >4s on CI). Room membership is the exact state
 * every room broadcast depends on, so waiting for it directly keys the test
 * to structure instead of timing (#171 review follow-up).
 * @param nsp - The namespace whose adapter to watch, e.g. `io.of('/staff')`.
 * @param room - The room name, e.g. `chat:{id}` or `tenant:{id}`.
 * @param size - Minimum member count to wait for.
 * @param timeoutMs - Give-up threshold.
 */
export async function waitForRoomSize(
  nsp: { adapter: { rooms: Map<string, Set<string>> } },
  room: string,
  size: number,
  timeoutMs = 5000,
): Promise<void> {
  await waitUntil(
    () => (nsp.adapter.rooms.get(room)?.size ?? 0) >= size,
    `room ${room} did not reach ${String(size)} member(s)`,
    timeoutMs,
  );
}

/**
 * Poll a namespace's adapter until `room` holds at most `size` members. The
 * shrink counterpart of {@link waitForRoomSize}: a client `disconnect()`
 * resolves before the server has processed the departure, so a test that
 * asserts on post-disconnect state waits for the membership to actually drop.
 * @param nsp - The namespace whose adapter to watch.
 * @param room - The room name.
 * @param size - Maximum member count to wait for.
 * @param timeoutMs - Give-up threshold.
 */
export async function waitForRoomSizeAtMost(
  nsp: { adapter: { rooms: Map<string, Set<string>> } },
  room: string,
  size: number,
  timeoutMs = 5000,
): Promise<void> {
  await waitUntil(
    () => (nsp.adapter.rooms.get(room)?.size ?? 0) <= size,
    `room ${room} did not drop to ${String(size)} member(s)`,
    timeoutMs,
  );
}

/**
 * Poll an arbitrary condition until it holds. The general form behind the
 * room waits, for states the adapter cannot see — e.g. a presence record the
 * next HTTP request will consult. Prefer the specific helpers where they fit;
 * a condition passed here should still be *structural* (the state an
 * assertion depends on), never a disguised sleep.
 * @param condition - Returns true (or a promise of true) once the state holds.
 * @param label - Failure description, phrased as what never happened.
 * @param timeoutMs - Give-up threshold.
 */
export async function waitUntil(
  condition: () => Promise<boolean> | boolean,
  label: string,
  timeoutMs = 5000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await condition()) return;
    if (Date.now() > deadline) {
      throw new Error(`${label} within ${String(timeoutMs)}ms`);
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
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
  const io = attachIo(httpServer, {
    env: base.env,
    logger: base.logger,
    redis: base.redis,
    services: base.services,
  });
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
