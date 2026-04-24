import compression from 'compression';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import express, { type Express } from 'express';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import swaggerUi from 'swagger-ui-express';

import { buildOpenApiSpec } from './config/swagger.js';
import { correlationMiddleware } from './middlewares/correlation.js';
import { errorHandler } from './middlewares/error-handler.js';
import { notFoundHandler } from './middlewares/not-found-handler.js';
import { createGlobalLimiter } from './middlewares/rate-limit.js';
import { buildRouter } from './routes/index.js';

import type { Env } from './config/env.js';
import type { Services } from './services/index.js';
import type { Redis } from 'ioredis';
import type { Logger } from 'pino';

interface AppDeps {
  env: Env;
  logger: Logger;
  redis: Redis;
  services: Services;
  /**
   * Skip global rate limiting. Set to `true` in unit tests where the Redis
   * stub can't satisfy the rate-limit-redis Lua protocol.
   */
  skipRateLimit?: boolean;
}

/**
 * Assemble the Express application with all middleware and routes.
 * @param deps - Runtime dependencies.
 * @returns A configured Express instance; call `.listen(port)` to start it.
 */
export function createApp(deps: AppDeps): Express {
  const { env, logger, redis, services } = deps;
  const app = express();

  app.disable('x-powered-by');
  app.set('trust proxy', 1);

  app.use(helmet());
  app.use(
    cors({
      origin: env.APP_URL,
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-Correlation-ID', 'X-XSRF-TOKEN'],
    }),
  );
  app.use(compression());
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true, limit: '1mb' }));
  app.use(cookieParser(env.COOKIE_SECRET));

  app.use(correlationMiddleware());
  app.use(
    pinoHttp({
      logger,
      customProps: (req) => ({ correlationId: req.correlationId }),
      autoLogging: {
        ignore: (req) => req.url === '/api/v1/health',
      },
    }),
  );

  app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(buildOpenApiSpec(env)));

  const v1 = buildRouter({
    env,
    redis,
    services,
    ...(deps.skipRateLimit === true && { skipRateLimit: true }),
  });
  if (deps.skipRateLimit === true) {
    app.use('/api/v1', v1);
    app.use('/v1', v1);
  } else {
    app.use('/api/v1', createGlobalLimiter(redis), v1);
    app.use('/v1', createGlobalLimiter(redis), v1);
  }

  app.use(notFoundHandler());
  app.use(errorHandler(logger));

  return app;
}
