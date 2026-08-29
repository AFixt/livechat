import { createServer, type Server as HttpServer } from 'node:http';
import { type AddressInfo } from 'node:net';

import Redis from 'ioredis';
import { pino, type Logger } from 'pino';
import { Server } from 'socket.io';
import { io as ioClient, type Socket } from 'socket.io-client';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';

import { createSocketRedisAdapter } from '../../src/io/adapter.js';

import { integrationDbUp, testEnv } from './setup.js';

const NS = '/adapter-test';

interface Instance {
  url: string;
  /** Broadcast a `ping` to a room from this instance's Socket.IO server. */
  broadcast: (room: string, payload: { msg: string }) => void;
  close: () => Promise<void>;
}

/**
 * Stand up a standalone Socket.IO instance wired with the project's Redis
 * adapter, on its own HTTP port but pointed at the shared Redis — i.e. one of
 * N API processes behind the load balancer (#73).
 * @param env - Test env carrying the Redis connection.
 * @param logger - Logger for the adapter.
 * @returns The instance URL and a close hook, or `null` if Redis is unreachable.
 */
async function startInstance(
  env: ReturnType<typeof testEnv>,
  logger: Logger,
): Promise<Instance | null> {
  const redis = new Redis({
    host: env.REDIS_HOST,
    port: env.REDIS_PORT,
    lazyConnect: true,
    maxRetriesPerRequest: 0,
    connectTimeout: 1000,
  });
  try {
    await redis.connect();
  } catch {
    await redis.quit().catch(() => undefined);
    return null;
  }

  const sa = createSocketRedisAdapter({ redis, logger, health: { ready: false } });
  const httpServer: HttpServer = createServer();
  const io = new Server(httpServer, { path: '/api/socket.io' });
  io.adapter(sa.adapter);
  io.of(NS).on('connection', (socket) => {
    socket.on('join', (room: string, ack: () => void) => {
      void Promise.resolve(socket.join(room)).then(ack);
    });
  });

  await new Promise<void>((resolve) => {
    httpServer.listen(0, '127.0.0.1', () => {
      resolve();
    });
  });
  const addr = httpServer.address() as AddressInfo;

  return {
    url: `http://127.0.0.1:${addr.port.toString()}`,
    broadcast: (room, payload) => {
      io.of(NS).to(room).emit('ping', payload);
    },
    close: async () => {
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
      await sa.close();
      await redis.quit().catch(() => undefined);
    },
  };
}

/**
 * Connect a client, wait for `connect`, and join `room` (awaiting the ack).
 * @param url - Instance URL.
 * @param room - Room to join.
 * @returns The connected client.
 */
async function connectAndJoin(url: string, room: string): Promise<Socket> {
  const socket = ioClient(`${url}${NS}`, {
    path: '/api/socket.io',
    transports: ['websocket'],
    forceNew: true,
  });
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error('connect timeout'));
    }, 3000);
    socket.once('connect', () => {
      clearTimeout(timer);
      resolve();
    });
  });
  await new Promise<void>((resolve) => {
    socket.emit('join', room, () => {
      resolve();
    });
  });
  return socket;
}

describe.skipIf(!integrationDbUp)('socket.io redis adapter (integration)', () => {
  let a: Instance | null = null;
  let b: Instance | null = null;

  beforeAll(async () => {
    const env = testEnv();
    const logger = pino({ level: 'silent' });
    a = await startInstance(env, logger);
    b = await startInstance(env, logger);
    if (a === null || b === null) {
      console.warn('[integration] Redis not reachable — skipping adapter test');
    }
  }, 30_000);

  afterAll(async () => {
    if (a !== null) await a.close();
    if (b !== null) await b.close();
  });

  test('a room broadcast on instance A reaches a client on instance B', async () => {
    if (a === null || b === null) return;
    const room = 'chat:cross-instance';

    // clientA lands on instance A, clientB on instance B — the split a load
    // balancer would produce. Both join the same room.
    const clientA = await connectAndJoin(a.url, room);
    const clientB = await connectAndJoin(b.url, room);

    const receivedOnB = new Promise<{ msg: string }>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error('cross-instance broadcast not received — adapter not wired'));
      }, 3000);
      clientB.once('ping', (payload: { msg: string }) => {
        clearTimeout(timer);
        resolve(payload);
      });
    });

    // Broadcast from instance A only. Without the Redis adapter this stays in
    // A's process and clientB (on B) never sees it.
    a.broadcast(room, { msg: 'hello-across-instances' });

    const payload = await receivedOnB;
    expect(payload.msg).toBe('hello-across-instances');

    clientA.disconnect();
    clientB.disconnect();
  }, 20_000);
});
