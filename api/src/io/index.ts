import { Server } from 'socket.io';

import { registerStaffNamespace } from './staff-namespace.js';
import { registerVisitorNamespace } from './visitor-namespace.js';

import type { SocketRedisAdapter } from './adapter.js';
import type { Env } from '../config/env.js';
import type { Services } from '../services/index.js';
import type { Redis } from 'ioredis';
import type { Server as HttpServer } from 'node:http';
import type { Logger } from 'pino';

interface IoDeps {
  env: Pick<Env, 'JWT_ACCESS_SECRET' | 'APP_URL'>;
  logger: Logger;
  redis: Redis;
  services: Services;
  /**
   * Optional Socket.IO Redis adapter. Required for multi-instance deploys so
   * rooms span processes (#73); omitted only in single-process tests where
   * per-process rooms are sufficient.
   */
  adapter?: SocketRedisAdapter['adapter'];
}

/**
 * Attach Socket.IO to an HTTP server with the `/staff` and `/visitor`
 * namespaces registered.
 * @param httpServer - The Node http server from `http.createServer(app)`.
 * @param deps - Env, logger, redis, services, and an optional Redis adapter.
 * @returns The Socket.IO server.
 */
export function attachIo(httpServer: HttpServer, deps: IoDeps): Server {
  const io = new Server(httpServer, {
    cors: { origin: deps.env.APP_URL, credentials: true },
    path: '/api/socket.io',
  });
  // Cross-instance rooms: without the adapter, a broadcast only reaches
  // clients on the same process (#73).
  if (deps.adapter !== undefined) io.adapter(deps.adapter);
  registerStaffNamespace({
    io,
    env: deps.env,
    redis: deps.redis,
    logger: deps.logger,
    services: deps.services,
  });
  registerVisitorNamespace({ io, logger: deps.logger, services: deps.services });
  return io;
}
