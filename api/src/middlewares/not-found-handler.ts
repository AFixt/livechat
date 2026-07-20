import { ApiError } from '../utils/api-error.js';

import type { RequestHandler } from 'express';

/**
 * Fallback middleware for requests that don't match any route.
 * @returns An Express middleware that throws a 404 ApiError.
 */
export function notFoundHandler(): RequestHandler {
  return (req, _res, next) => {
    next(ApiError.notFound(`Route not found: ${req.method} ${req.path}`));
  };
}
