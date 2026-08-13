import { pino } from 'pino';
import { describe, expect, test, vi } from 'vitest';

import { createShutdownHandler, type ShutdownDeps } from './graceful-shutdown.js';

const silentLogger = pino({ level: 'silent' });

/**
 * Build shutdown deps whose collaborators are all spies.
 * @param overrides - Behaviour to override on the fakes.
 * @returns The deps plus direct handles on each spy.
 */
function makeDeps(
  overrides: {
    /** Invoke `io.close`'s callback (default true). */
    ioCloses?: boolean;
    /** Make `sequelize.close()` reject. */
    sequelizeRejects?: boolean;
  } = {},
): {
  deps: ShutdownDeps;
  disconnectSockets: ReturnType<typeof vi.fn>;
  closeIdleConnections: ReturnType<typeof vi.fn>;
  ioClose: ReturnType<typeof vi.fn>;
  sequelizeClose: ReturnType<typeof vi.fn>;
  redisQuit: ReturnType<typeof vi.fn>;
  exit: ReturnType<typeof vi.fn>;
} {
  const disconnectSockets = vi.fn();
  const closeIdleConnections = vi.fn();
  const ioClose = vi.fn((cb?: () => void) => {
    if (overrides.ioCloses !== false) cb?.();
  });
  const sequelizeClose = vi.fn(() =>
    overrides.sequelizeRejects === true ? Promise.reject(new Error('boom')) : Promise.resolve(),
  );
  const redisQuit = vi.fn(() => Promise.resolve('OK'));
  const exit = vi.fn();

  return {
    deps: {
      io: { disconnectSockets, close: ioClose } as unknown as ShutdownDeps['io'],
      httpServer: { closeIdleConnections },
      sequelize: { close: sequelizeClose },
      redis: { quit: redisQuit } as unknown as ShutdownDeps['redis'],
      logger: silentLogger,
      timeoutMs: 50,
      exit: exit as unknown as (code: number) => never,
    },
    disconnectSockets,
    closeIdleConnections,
    ioClose,
    sequelizeClose,
    redisQuit,
    exit,
  };
}

describe('createShutdownHandler', () => {
  test('disconnects Socket.IO clients with close:true so they reconnect elsewhere', () => {
    const h = makeDeps();
    createShutdownHandler(h.deps)('SIGTERM');

    // `true` tears down the transport (client sees a transport close and
    // retries). `false` would send a disconnect packet and the client would
    // give up permanently — the distinction this whole fix turns on.
    expect(h.disconnectSockets).toHaveBeenCalledWith(true);
  });

  test('drops idle keep-alive HTTP connections so close() can complete', () => {
    const h = makeDeps();
    createShutdownHandler(h.deps)('SIGTERM');

    expect(h.closeIdleConnections).toHaveBeenCalledOnce();
  });

  test('closes the database and redis once the server has closed', async () => {
    const h = makeDeps();
    createShutdownHandler(h.deps)('SIGTERM');
    await vi.waitFor(() => {
      expect(h.sequelizeClose).toHaveBeenCalledOnce();
    });

    expect(h.redisQuit).toHaveBeenCalledOnce();
  });

  test('does not force-exit when shutdown completes within the timeout', async () => {
    const h = makeDeps();
    createShutdownHandler(h.deps)('SIGTERM');

    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(h.exit).not.toHaveBeenCalled();
  });

  test('force-exits when the server never finishes closing', async () => {
    const h = makeDeps({ ioCloses: false });
    createShutdownHandler(h.deps)('SIGTERM');

    // The regression this guards: the old code assigned `process.exitCode`
    // instead of exiting, so a hung close left the process alive forever.
    await vi.waitFor(() => {
      expect(h.exit).toHaveBeenCalledWith(1);
    });
  });

  test('force-exits when winding down the database or redis rejects', async () => {
    const h = makeDeps({ sequelizeRejects: true });
    createShutdownHandler(h.deps)('SIGTERM');

    await vi.waitFor(() => {
      expect(h.exit).toHaveBeenCalledWith(1);
    });
  });

  test('ignores repeat signals rather than restarting the sequence', () => {
    const h = makeDeps();
    const shutdown = createShutdownHandler(h.deps);
    shutdown('SIGTERM');
    shutdown('SIGINT');

    expect(h.disconnectSockets).toHaveBeenCalledOnce();
    expect(h.ioClose).toHaveBeenCalledOnce();
  });
});
