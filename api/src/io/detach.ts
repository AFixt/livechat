import type { Logger } from 'pino';

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
