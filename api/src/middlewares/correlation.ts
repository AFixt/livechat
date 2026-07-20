import { randomUUID } from 'node:crypto';

import type { RequestHandler } from 'express';

/**
 * Name of the header that carries the correlation ID in both directions.
 */
export const CORRELATION_HEADER = 'x-correlation-id';

declare module 'express-serve-static-core' {
  interface Request {
    /** Per-request correlation ID. Populated by {@link correlationMiddleware}. */
    correlationId?: string;
  }
}

/**
 * Assign a correlation ID to every request (honoring a client-supplied one if
 * present) and echo it back on the response.
 * @returns An Express middleware.
 */
export function correlationMiddleware(): RequestHandler {
  return (req, res, next) => {
    const fromHeader = req.header(CORRELATION_HEADER);
    const id = typeof fromHeader === 'string' && fromHeader.length > 0 ? fromHeader : randomUUID();
    req.correlationId = id;
    res.setHeader(CORRELATION_HEADER, id);
    next();
  };
}
