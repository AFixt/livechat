import { ZodError } from 'zod';

import { ApiError } from '../utils/api-error.js';

import type { ErrorRequestHandler } from 'express';
import type { Logger } from 'pino';

interface ErrorPayload {
  success: false;
  message: string;
  details?: unknown;
}

/**
 * Central error handler. Serializes `ApiError` and Zod errors into the
 * response envelope; logs everything else as `error` and returns 500.
 * @param logger - Pino logger.
 * @returns An Express error-handling middleware.
 */
export function errorHandler(logger: Logger): ErrorRequestHandler {
  return (err, req, res, _next) => {
    const body: ErrorPayload = { success: false, message: 'Internal server error' };
    let status = 500;

    if (err instanceof ApiError) {
      status = err.status;
      body.message = err.message;
      if (err.details !== undefined) {
        body.details = err.details;
      }
    } else if (err instanceof ZodError) {
      status = 400;
      body.message = 'Validation failed';
      body.details = err.issues;
    } else if (err instanceof Error) {
      logger.error({ err, correlationId: req.correlationId, path: req.path }, 'unhandled error');
    } else {
      logger.error(
        { err, correlationId: req.correlationId, path: req.path },
        'unhandled non-error throw',
      );
    }

    res.status(status).json(body);
  };
}
