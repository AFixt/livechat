import compression from 'compression';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import express, { type Express } from 'express';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import swaggerUi from 'swagger-ui-express';

import { buildOpenApiSpec } from './config/swagger.js';
import { correlationMiddleware } from './middlewares/correlation.js';
import { buildCorsDelegate } from './middlewares/cors.js';
import { errorHandler } from './middlewares/error-handler.js';
import { notFoundHandler } from './middlewares/not-found-handler.js';
import { createGlobalLimiter } from './middlewares/rate-limit.js';
import { buildRouter } from './routes/index.js';

import type { Env } from './config/env.js';
import type { AdapterHealth } from './io/adapter.js';
import type { Services } from './services/index.js';
import type { Redis } from 'ioredis';
import type { Logger } from 'pino';

interface AppDeps {
  env: Env;
  logger: Logger;
  redis: Redis;
  services: Services;
  /** Socket.IO Redis adapter health, surfaced by `/health` (#73). */
  socketAdapterHealth?: AdapterHealth;
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
  // Console routes keep the strict single-origin (APP_URL) policy; widget-facing
  // routes reflect the requesting origin when it belongs to a tenant's
  // allowed_origins, so the embeddable widget works cross-site (#74).
  app.use(cors(buildCorsDelegate(env)));
  app.use(compression());
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true, limit: '1mb' }));
  app.use(cookieParser(env.COOKIE_SECRET));

  app.use(correlationMiddleware());
  app.use(
    pinoHttp({
      logger,
      customProps: (req) => ({
        correlationId: (req as unknown as { correlationId?: string }).correlationId,
      }),
      autoLogging: {
        ignore: (req) => req.url === '/api/v1/health',
      },
    }),
  );

  // The OpenAPI spec + Swagger UI publish the entire route and schema
  // inventory, including every admin surface, with no auth. Serving that in
  // production is free reconnaissance for an attacker (#78), so it is mounted
  // only outside production; developers read it from a local/staging run. See
  // docs/deploy.md.
  if (env.NODE_ENV !== 'production') {
    // `buildOpenApiSpec` is typed `any` by zod-to-openapi; narrow to `object`
    // so it can be served and handed to swagger-ui without unsafe-any usage.
    const openApiSpec = buildOpenApiSpec(env) as object;
    // Raw machine-readable spec for tooling (e.g. schema-based testing).
    app.get('/api/docs.json', (_req, res) => {
      res.json(openApiSpec);
    });
    /* eslint-disable @typescript-eslint/no-deprecated -- swagger-ui-express 5 still ships .setup; replacement API not yet stable */
    app.use(
      '/api/docs',
      swaggerUi.serve,
      swaggerUi.setup(openApiSpec as unknown as Parameters<typeof swaggerUi.setup>[0]),
    );
    /* eslint-enable @typescript-eslint/no-deprecated */
  }

  const v1 = buildRouter({
    env,
    redis,
    services,
    ...(deps.socketAdapterHealth && { socketAdapterHealth: deps.socketAdapterHealth }),
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
  app.use(errorHandler(logger, services.audit));

  return app;
}
