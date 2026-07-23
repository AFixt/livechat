import { ZodError } from 'zod';

import { ApiError } from '../utils/api-error.js';
import { recordAudit } from '../utils/audit.js';

import type { AuditService } from '../services/audit-service.js';
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
 *
 * Also the single place authorization failures are audited. Every guard funnels
 * its `ApiError` through here, so recording 401/403 centrally captures denials
 * — including the tenant-isolation checks — without wrapping each call site.
 * @param logger - Pino logger.
 * @param audit - Audit service; omit to disable denial auditing.
 * @returns An Express error-handling middleware.
 */
export function errorHandler(logger: Logger, audit?: AuditService): ErrorRequestHandler {
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

    if (audit !== undefined && (status === 401 || status === 403)) {
      // Detached: a denial must still be returned promptly even if the audit
      // write is slow, and `record` swallows its own failures.
      void recordAudit(audit, req, {
        action: status === 401 ? 'auth.denied' : 'access.denied',
        resourceType: 'http',
        metadata: { method: req.method, path: req.path, reason: body.message },
      });
    }

    res.status(status).json(body);
  };
}
