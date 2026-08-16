import { ApiError } from '../utils/api-error.js';

import type { Logger } from 'pino';

/** Payload sent back to a socket when one of its events is rejected. */
export interface SocketErrorPayload {
  /** The client event that failed (e.g. `chat:accept`). */
  event: string;
  /** Human-readable reason, safe to show the caller. */
  message: string;
}

/**
 * Run a fire-and-forget async socket handler and, on failure, report it back
 * to the initiating socket as a `chat:error` event instead of swallowing it
 * (issue #72). Authorization/validation rejections ({@link ApiError}) are
 * logged at `warn` and their message forwarded; anything else is logged at
 * `error` and reported generically so internals never leak to the client.
 * @param logger - Logger for the failure.
 * @param emitError - Emits the error back to the one offending socket.
 * @param event - The client event being handled, echoed back to the caller.
 * @param run - The async work to start.
 */
export function guard(
  logger: Logger,
  emitError: (payload: SocketErrorPayload) => void,
  event: string,
  run: () => Promise<unknown>,
): void {
  run().catch((err: unknown) => {
    const isApi = err instanceof ApiError;
    if (isApi) logger.warn({ err, event }, 'socket event rejected');
    else logger.error({ err, event }, 'socket event failed');
    emitError({ event, message: isApi ? err.message : 'Unexpected error' });
  });
}

/**
 * Run a fire-and-forget async socket handler, reporting failures instead of
 * leaving the rejection unhandled.
 *
 * @remarks
 * Socket.IO event callbacks are synchronous, so async work inside them has
 * no caller to await it. Without this, a rejected promise — a dropped Redis
 * connection mid-command, a failed write — surfaces as an unhandled
 * rejection, which Node treats as fatal by default. One transient
 * infrastructure blip would take the process down.
 *
 * @param logger - Logger for the failure.
 * @param message - What was being attempted, logged alongside the error.
 * @param run - The async work to start.
 */
export function detach(logger: Logger, message: string, run: () => Promise<unknown>): void {
  run().catch((err: unknown) => {
    logger.error({ err }, message);
  });
}
