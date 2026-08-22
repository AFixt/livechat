import { createServer } from 'node:http';

import { createApp } from './app.js';
import { loadEnv } from './config/env.js';
import { createLogger } from './config/logger.js';
import { createSequelize } from './config/mysql.js';
import { createRedis } from './config/redis.js';
import { createSocketRedisAdapter, type AdapterHealth } from './io/adapter.js';
import { attachIo } from './io/index.js';
import { createIoRef } from './io/io-ref.js';
import { createShutdownHandler } from './lifecycle/graceful-shutdown.js';
import { initModels } from './models/index.js';
import { createServices } from './services/index.js';

const env = loadEnv();
const logger = createLogger(env);
const sequelize = createSequelize(env, logger);
const redis = createRedis(env, logger);

initModels(sequelize);
const services = createServices({ env, logger, redis });

// Socket.IO Redis adapter so rooms span instances behind the load balancer
// (#73). Its readiness is shared into the app so `/health` reports it.
const socketAdapterHealth: AdapterHealth = { ready: false };
const socketAdapter = createSocketRedisAdapter({ redis, logger, health: socketAdapterHealth });

// In test (e2e) the auth limiter's `max: 5` would trip across repeated
// logins and CI retries; NODE_ENV is only ever 'test' for the e2e stack,
// never a deployed server, so this is safe.
// Filled in immediately after `attachIo` below — the app must exist first,
// because Socket.IO attaches to the HTTP server that wraps it (#123).
const ioRef = createIoRef();
const app = createApp({
  env,
  logger,
  redis,
  services,
  socketAdapterHealth,
  ioRef,
  ...(env.NODE_ENV === 'test' && { skipRateLimit: true }),
});
const server = createServer(app);
const io = attachIo(server, { env, logger, redis, services, adapter: socketAdapter.adapter });
ioRef.current = io;

// A port clash otherwise surfaces as an unhandled EADDRINUSE stack trace (#81).
server.on('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EADDRINUSE') {
    logger.fatal(`port ${String(env.PORT)} is already in use — stop the other process or set PORT`);
  } else {
    logger.fatal({ err }, 'HTTP server error');
  }
  process.exitCode = 1;
});

/**
 * Bring up database + redis + HTTP server. Sets `process.exitCode` on failure
 * and returns so Node can drain any pending IO before exiting.
 * @returns Resolves when the server is listening (or has failed to start).
 */
async function start(): Promise<void> {
  try {
    await sequelize.authenticate();
    logger.info('database connection established');

    // `lazyConnect: true` on the ioredis client plus the rate limiter
    // constructed inside `createApp` already issues a command, so ioredis
    // is connecting by the time we get here. A ping is the simplest way to
    // both wait for readiness and surface connection failures at boot.
    await redis.ping();
    logger.info('redis connection established');

    server.listen(env.PORT, () => {
      logger.info({ port: env.PORT, env: env.NODE_ENV }, 'server listening');
    });
  } catch (error) {
    logger.fatal({ err: error }, 'failed to start');
    process.exitCode = 1;
  }
}

const shutdown = createShutdownHandler({
  io,
  httpServer: server,
  sequelize,
  redis,
  closeAdapter: socketAdapter.close,
  logger,
});

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

void start();
