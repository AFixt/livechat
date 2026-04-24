import { createServer } from 'node:http';

import { createApp } from './app.js';
import { loadEnv } from './config/env.js';
import { createLogger } from './config/logger.js';
import { createSequelize } from './config/mysql.js';
import { createRedis } from './config/redis.js';
import { initModels } from './models/index.js';
import { createServices } from './services/index.js';

const env = loadEnv();
const logger = createLogger(env);
const sequelize = createSequelize(env, logger);
const redis = createRedis(env, logger);

initModels(sequelize);
const services = createServices({ env, logger, redis });

const app = createApp({ env, logger, redis, services });
const server = createServer(app);

const SHUTDOWN_TIMEOUT_MS = 10_000;

/**
 * Bring up database + redis + HTTP server. Sets `process.exitCode` on failure
 * and returns so Node can drain any pending IO before exiting.
 * @returns Resolves when the server is listening (or has failed to start).
 */
async function start(): Promise<void> {
  try {
    await sequelize.authenticate();
    logger.info('database connection established');

    await redis.connect();
    logger.info('redis connection established');

    server.listen(env.PORT, () => {
      logger.info({ port: env.PORT, env: env.NODE_ENV }, 'server listening');
    });
  } catch (error) {
    logger.fatal({ err: error }, 'failed to start');
    process.exitCode = 1;
  }
}

/**
 * Gracefully close the HTTP server, database, and redis, then exit.
 * Forces exit after {@link SHUTDOWN_TIMEOUT_MS}.
 * @param signal - The signal that triggered shutdown.
 */
function shutdown(signal: NodeJS.Signals): void {
  logger.info({ signal }, 'shutting down');

  const forceTimer = setTimeout(() => {
    logger.error('forced shutdown after timeout');
    process.exitCode = 1;
  }, SHUTDOWN_TIMEOUT_MS);
  forceTimer.unref();

  server.close(() => {
    Promise.allSettled([sequelize.close(), redis.quit()])
      .then(() => {
        clearTimeout(forceTimer);
        logger.info('shutdown complete');
      })
      .catch((err: unknown) => {
        logger.error({ err }, 'error during shutdown');
        process.exitCode = 1;
      });
  });
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

void start();
