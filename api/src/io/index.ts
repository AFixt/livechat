import { Server } from 'socket.io';

import { registerStaffNamespace } from './staff-namespace.js';
import { registerVisitorNamespace } from './visitor-namespace.js';

import type { Env } from '../config/env.js';
import type { Services } from '../services/index.js';
import type { Server as HttpServer } from 'node:http';

interface IoDeps {
  env: Pick<Env, 'JWT_ACCESS_SECRET' | 'APP_URL'>;
  services: Services;
}

/**
 * Attach Socket.IO to an HTTP server with the `/staff` and `/visitor`
 * namespaces registered.
 * @param httpServer - The Node http server from `http.createServer(app)`.
 * @param deps - Env + services.
 * @returns The Socket.IO server.
 */
export function attachIo(httpServer: HttpServer, deps: IoDeps): Server {
  const io = new Server(httpServer, {
    cors: { origin: deps.env.APP_URL, credentials: true },
    path: '/api/socket.io',
  });
  registerStaffNamespace({ io, env: deps.env, services: deps.services });
  registerVisitorNamespace({ io, services: deps.services });
  return io;
}
