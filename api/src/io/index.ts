import { Server } from 'socket.io';

import { registerStaffNamespace } from './staff-namespace.js';
import { registerVisitorNamespace } from './visitor-namespace.js';

import type { Env } from '../config/env.js';
import type { Services } from '../services/index.js';
import type { Server as HttpServer } from 'node:http';
import type { Logger } from 'pino';

interface IoDeps {
  env: Pick<Env, 'JWT_ACCESS_SECRET' | 'APP_URL'>;
  logger: Logger;
  services: Services;
}

/**
 * Attach Socket.IO to an HTTP server with the `/staff` and `/visitor`
 * namespaces registered.
 * @param httpServer - The Node http server from `http.createServer(app)`.
 * @param deps - Env, logger, and services.
 * @returns The Socket.IO server.
 */
export function attachIo(httpServer: HttpServer, deps: IoDeps): Server {
  const io = new Server(httpServer, {
    cors: { origin: deps.env.APP_URL, credentials: true },
    path: '/api/socket.io',
  });
  registerStaffNamespace({ io, env: deps.env, logger: deps.logger, services: deps.services });
  registerVisitorNamespace({ io, logger: deps.logger, services: deps.services });
  return io;
}
