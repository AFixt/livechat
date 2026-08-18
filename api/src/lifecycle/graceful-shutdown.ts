import type { Redis } from 'ioredis';
import type { Server as HttpServer } from 'node:http';
import type { Logger } from 'pino';
import type { Sequelize } from 'sequelize';
import type { Server as IoServer } from 'socket.io';

/** How long to wait for a clean shutdown before forcing the process down. */
export const SHUTDOWN_TIMEOUT_MS = 10_000;

/**
 * Collaborators the shutdown sequence has to wind down.
 * @remarks
 * Injected rather than imported so the sequence can be unit-tested with fakes.
 */
export interface ShutdownDeps {
  /** Socket.IO server. Closing it also closes the HTTP server it is attached to. */
  io: Pick<IoServer, 'disconnectSockets' | 'close'>;
  /** The HTTP server, used to drop idle keep-alive connections. */
  httpServer: Pick<HttpServer, 'closeIdleConnections'>;
  /** Sequelize instance to close. */
  sequelize: Pick<Sequelize, 'close'>;
  /** Redis client to quit. */
  redis: Pick<Redis, 'quit'>;
  /**
   * Close the Socket.IO Redis adapter's pub/sub connections, if installed
   * (#73). They are separate ioredis connections and would otherwise keep the
   * event loop alive past `io.close()`, so they must be quit alongside the
   * shared client.
   */
  closeAdapter?: () => Promise<unknown>;
  /** Structured logger. */
  logger: Logger;
  /** Milliseconds to wait before forcing exit. Defaults to {@link SHUTDOWN_TIMEOUT_MS}. */
  timeoutMs?: number;
  /** Process-exit hook, injectable for tests. Defaults to `process.exit`. */
  exit?: (code: number) => never;
}

/**
 * Build a signal handler that shuts the process down cleanly.
 * @remarks
 * `http.Server#close()` only stops *new* connections — it never closes
 * established ones, and Socket.IO WebSockets never end on their own. Closing
 * the HTTP server alone therefore hangs forever while any client is connected,
 * leaving an orphaned process that keeps serving the old code after a deploy.
 *
 * So the order matters: disconnect every Socket.IO client first (with
 * `close: true`, which tears down the underlying transport so clients treat it
 * as a transport close and reconnect to the new instance — a plain disconnect
 * packet would make them give up instead), drop idle keep-alive HTTP sockets,
 * and only then close the server and the database/cache handles.
 *
 * The force-exit timer is deliberately **not** `unref()`d and calls
 * `process.exit()` rather than assigning `process.exitCode`: assigning
 * `exitCode` does nothing while the event loop still has open handles, which is
 * exactly the situation it exists to escape.
 * @param deps - Collaborators to wind down.
 * @returns A handler safe to register on `SIGTERM`/`SIGINT`; repeat signals are ignored.
 */
export function createShutdownHandler(deps: ShutdownDeps): (signal: NodeJS.Signals) => void {
  const timeoutMs = deps.timeoutMs ?? SHUTDOWN_TIMEOUT_MS;
  const exit =
    deps.exit ??
    // The one place an explicit exit is correct: this is the last-resort escape
    // from a shutdown that will not complete, and throwing here would be caught
    // by nothing and leave the process running — the exact bug being fixed.
    // eslint-disable-next-line n/no-process-exit
    ((code: number): never => process.exit(code));
  let shuttingDown = false;

  return function shutdown(signal: NodeJS.Signals): void {
    if (shuttingDown) {
      deps.logger.warn({ signal }, 'shutdown already in progress, ignoring signal');
      return;
    }
    shuttingDown = true;
    deps.logger.info({ signal }, 'shutting down');

    const forceTimer = setTimeout(() => {
      deps.logger.error('forced shutdown after timeout');
      exit(1);
    }, timeoutMs);

    // Boot every client off so they reconnect to the replacement instance.
    deps.io.disconnectSockets(true);
    // Keep-alive sockets with no request in flight would otherwise keep the
    // HTTP server open; in-flight requests are still allowed to finish.
    deps.httpServer.closeIdleConnections();

    void deps.io.close(() => {
      // `allSettled` so a failing redis quit still lets the database close.
      // It never rejects, so the failures have to be read out of the results
      // rather than caught — a `.catch` here would be dead code.
      void Promise.allSettled([
        deps.sequelize.close(),
        deps.redis.quit(),
        deps.closeAdapter?.() ?? Promise.resolve(),
      ]).then((results) => {
        clearTimeout(forceTimer);
        const failures = results.filter((r) => r.status === 'rejected');
        if (failures.length > 0) {
          deps.logger.error(
            { errs: failures.map((f) => f.reason as unknown) },
            'error while closing database or cache during shutdown',
          );
          exit(1);
          return;
        }
        deps.logger.info('shutdown complete');
      });
    });
  };
}
